import { fetchJSON, renderProjects } from '../global.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

let query = '';
let selectedIndex = -1;

const projects = await fetchJSON('../lib/projects.json');
const projectsTitle = document.querySelector('.projects-title');
projectsTitle.textContent = `Projects (${projects.length})`;
const projectsContainer = document.querySelector('.projects');
renderProjects(projects, projectsContainer, 'h2');

let searchInput = document.querySelector('.searchBar');
searchInput.addEventListener('change', (event) => {
    // update query value
    query = event.target.value;
    // TODO: filter the projects
    let filteredProjects = projects.filter((project) => {
        let values = Object.values(project).join('\n').toLowerCase();
        return values.includes(query.toLowerCase());
    });
    // TODO: render updated projects!
    renderProjects(filteredProjects, projectsContainer, 'h2');
    renderPieChart(filteredProjects);
});

function renderPieChart(projectsGiven) {
  let newRolledData = d3.rollups(
    projectsGiven,
    (v) => v.length,
    (d) => d.year,
  );

  let newData = newRolledData.map(([year, count]) => {
    return { value: count, label: year };
  });

  let newArcGenerator = d3.arc().innerRadius(0).outerRadius(50);
  let newSliceGenerator = d3.pie().value((d) => d.value);
  let newArcData = newSliceGenerator(newData);
  let newArcs = newArcData.map((d) => newArcGenerator(d));
  let newColors = d3.scaleOrdinal(d3.schemeTableau10);

  let newSVG = d3.select('svg');
  newSVG.selectAll('path').remove();

  let newLegend = d3.select('.legend');
  newLegend.selectAll('li').remove();

  newData.forEach((d, idx) => {
    newLegend
      .append('li')
      .attr('class', 'legend-item')
      .attr('style', `--color:${newColors(idx)}`)
      .html(`<span class="swatch"></span> ${d.label} <em>(${d.value})</em>`);
  });

  newArcs.forEach((arc, idx) => {
    newSVG
        .append('path')
        .attr('d', arc)
        .attr('fill', newColors(idx))
        .on('click', () => {
            selectedIndex = selectedIndex === idx ? -1 : idx;
            

        newSVG
            .selectAll('path')
            .attr('class', (_, i) => (i === selectedIndex ? 'selected' : ''));

        newLegend
            .selectAll('li')
            .attr('class', (_, i) =>
                i === selectedIndex ? 'legend-item selected' : 'legend-item',
            );
        if (selectedIndex === -1) {
            renderProjects(projectsGiven, projectsContainer, 'h2');
        } else {
            let selectedYear = newData[selectedIndex].label;
            let selectedProjects = projectsGiven.filter(
                (project) => project.year === selectedYear,
        );
        renderProjects(selectedProjects, projectsContainer, 'h2');
    }
        });
    });;
}

renderPieChart(projects);


