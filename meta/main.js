import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

let xScale;
let yScale;
let brush;
let filteredCommits = [];
const colors = d3.scaleOrdinal(d3.schemeTableau10);

async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line), // or just +row.line
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

function processCommits(data) {
  return d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      const first = lines[0];
      const { author, date, time, timezone, datetime } = first;

      const ret = {
        id: commit,
        url: `https://github.com/Aurora-1420/portfolio/commit/${commit}`,
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
      };

      Object.defineProperty(ret, 'lines', {
        value: lines,
        enumerable: false,
      });

      return ret;
    })
    .sort((a, b) => a.datetime - b.datetime);
}

function updateCommitInfo(data, commits) {
  const stats = d3.select('#stats');
  stats.selectAll('*').remove();
  const dl = stats.append('dl').attr('class', 'stats');

  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(data.length);

  dl.append('dt').text('Total commits');
  dl.append('dd').text(commits.length);

  dl.append('dt').text('Number of files');
  dl.append('dd').text(d3.group(data, (d) => d.file).size);

  dl.append('dt').text('Average line length');
  dl.append('dd').text(d3.mean(data, (d) => d.length).toFixed(1));

  const fileLengths = d3.rollups(
    data,
    (rows) => d3.max(rows, (row) => row.line),
    (row) => row.file,
  );
  const longestFile = d3.greatest(fileLengths, (entry) => entry[1]);

  dl.append('dt').text(`Longest file (${longestFile[0]})`);
  dl.append('dd').text(longestFile[1]);
}

function updateFileDisplay(commits) {
  const lines = commits.flatMap((commit) => commit.lines);
  const files = d3
    .groups(lines, (line) => line.file)
    .map(([name, fileLines]) => ({ name, lines: fileLines }))
    .sort((a, b) => b.lines.length - a.lines.length);

  const fileRows = d3
    .select('#files')
    .selectAll('div')
    .data(files, (file) => file.name)
    .join((enter) =>
      enter.append('div').call((div) => {
        div.append('dt').append('code');
        div.append('dd');
      }),
    );

  fileRows.select('dt > code').text((file) => file.name);
  fileRows
    .select('dt')
    .selectAll('small')
    .data((file) => [file])
    .join('small')
    .text((file) => `${file.lines.length} lines`);

  fileRows
    .select('dd')
    .selectAll('.loc')
    .data(
      (file) => file.lines,
      (line) => `${line.commit}:${line.line}`,
    )
    .join('div')
    .attr('class', 'loc')
    .style('--color', (line) => colors(line.type));
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.style.left = `${event.clientX + 12}px`;
  tooltip.style.top = `${event.clientY + 12}px`;
}

function renderTooltipContent(commit) {
  const tooltip = document.getElementById('commit-tooltip');
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const time = document.getElementById('commit-time');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  if (!commit || Object.keys(commit).length === 0) return;

  tooltip.hidden = false;
  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime.toLocaleString('en', {
    dateStyle: 'full',
  });
  time.textContent = commit.time;
  author.textContent = commit.author;
  lines.textContent = commit.totalLines;
}

function isCommitSelected(selection, commit) {
  if (!selection) return false;

  const [[x0, y0], [x1, y1]] = selection;
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);

  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function renderSelectionCount(selection) {
  const countElement = document.querySelector('#selection-count');

  if (!selection) {
    countElement.textContent = 'No commits selected';
    return [];
  }

  const selectedCommits = filteredCommits.filter((d) =>
    isCommitSelected(selection, d),
  );
  countElement.textContent = `${selectedCommits.length} commits selected`;
  return selectedCommits;
}

function renderLanguageBreakdown(selection) {
  const container = document.getElementById('language-breakdown');

  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }

  const lines = selectedCommits.flatMap((d) => d.lines);
  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion);

    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

function brushed(event) {
  const selection = event.selection;
  d3.selectAll('circle').classed('selected', (d) =>
    isCommitSelected(selection, d),
  );

  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function renderScatterPlot(data, commits) {
  const width = 1000;
  const height = 600;
  const margin = { top: 10, right: 10, bottom: 30, left: 20 };

  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  xScale = d3
    .scaleTime()
    .domain(d3.extent(commits, (d) => d.datetime))
    .range([usableArea.left, usableArea.right])
    .nice();

  yScale = d3
    .scaleLinear()
    .domain([0, 24])
    .range([usableArea.bottom, usableArea.top]);

  const gridlines = svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`);

  gridlines.call(
    d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width),
  );

  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);

  const rScale = d3
    .scaleSqrt()
    .domain([minLines, maxLines])
    .range([2, 30]);

  const sortedCommits = d3.sort(commits, (a, b) => b.totalLines - a.totalLines);

  const dots = svg.append('g').attr('class', 'dots');

  dots
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .style('fill-opacity', 0.7)
    .attr('fill', 'steelblue')
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mousemove', (event) => {
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });

  brush = d3.brush().on('start brush end', brushed);
  svg.call(brush);
  svg.selectAll('.dots, .overlay ~ *').raise();

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3
    .axisLeft(yScale)
    .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00');

  svg
    .append('g')
    .attr('transform', `translate(0, ${usableArea.bottom})`)
    .attr('class', 'x-axis')
    .call(xAxis);

  svg
    .append('g')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .attr('class', 'y-axis')
    .call(yAxis);
}

const data = await loadData();
const commits = processCommits(data);
const timeScale = d3
  .scaleTime()
  .domain(d3.extent(commits, (d) => d.datetime))
  .range([0, 100]);

let commitProgress = 100;
let commitMaxTime;

function updateScatterPlot(commits) {
  const svg = d3.select('#chart').select('svg');
  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  const rScale = d3.scaleSqrt().domain([minLines, maxLines]).range([2, 30]);

  xScale = xScale.domain(d3.extent(commits, (d) => d.datetime));

  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(d3.axisBottom(xScale));

  const sortedCommits = d3.sort(commits, (a, b) => b.totalLines - a.totalLines);
  const dots = svg.select('g.dots');

  dots
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mousemove', (event) => {
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });

  svg.call(brush.move, null);
}

function updateTimeline(maxTime) {
  const slider = document.querySelector('#commit-progress');
  commitMaxTime = maxTime;
  commitProgress = timeScale(commitMaxTime);
  slider.value = String(commitProgress);
  document.querySelector('#commit-progress-time').textContent =
    commitMaxTime.toLocaleString('en', {
      dateStyle: 'long',
      timeStyle: 'short',
    });

  filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);
  updateCommitInfo(data, filteredCommits);
  updateFileDisplay(filteredCommits);
  updateScatterPlot(filteredCommits);
}

function onTimeSliderChange() {
  commitProgress = Number(document.querySelector('#commit-progress').value);
  updateTimeline(timeScale.invert(commitProgress));
}

function onStepEnter({ element }) {
  const commit = d3.select(element).datum();
  updateTimeline(commit.datetime);
}

filteredCommits = commits;
updateCommitInfo(data, commits);
renderScatterPlot(data, commits);
const slider = document.querySelector('#commit-progress');
slider.addEventListener('input', onTimeSliderChange);
onTimeSliderChange();

d3.select('#scatter-story')
  .selectAll('.step')
  .data(commits, (commit) => commit.id)
  .join('div')
  .attr('class', 'step')
  .html(
    (commit, index) => `
      On ${commit.datetime.toLocaleString('en', {
        dateStyle: 'full',
        timeStyle: 'short',
      })}, I made
      <a href="${commit.url}" target="_blank" rel="noopener noreferrer">${
        index > 0 ? 'another commit' : 'my first commit'
      }</a>.
      I edited ${commit.totalLines} lines across ${
        d3.rollups(
          commit.lines,
          (lines) => lines.length,
          (line) => line.file,
        ).length
      } files.
    `,
  );

scrollama()
  .setup({
    container: '#scrolly-1',
    step: '#scrolly-1 .step',
    offset: 0.5,
  })
  .onStepEnter(onStepEnter);