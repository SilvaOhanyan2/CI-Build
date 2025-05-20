async function main() {
	const projectBranchesId = '47a08f3f-55c0-45ad-89b4-aeae906c104f-48081be1-44e6-4c83-b035-1c43a589990f';

	const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Build Results</title>
  <style>
    /* Fill viewport */
    html, body { margin:0; height:100%; }
    body {
      display: flex;
      flex-direction: column;
      font-family: Arial, sans-serif;
      background: #f7f9fb;
      color: #333;
    }
    .container {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    h1 {
      margin: 16px 0;
      text-align: center;
      color: #203864;
    }
    #filterBar {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      background: #e9ecef;
      padding: 8px;
    }
    #filterBar label { font-weight: 500; }
    #filterBar select {
      padding: 6px 10px;
      border: 1px solid #cad1d8;
      border-radius: 4px;
      background: #fff;
    }
    #refreshBtn {
      align-self: center;
      margin: 8px 0;
      padding: 6px 16px;
      border: none;
      border-radius: 4px;
      background: #0d6efd;
      color: #fff;
      cursor: pointer;
    }
    #refreshBtn:hover { background: #0b5ed7; }

    /* Table wrapper to flex‐fill */
    .table-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    thead, tbody { display: block; }
    tbody {
      flex: 1;
      overflow-y: auto;
    }
    thead tr, tbody tr {
      display: table;
      width: 100%;
      table-layout: fixed;
    }
    thead th {
      background: #203864;
      color: #fff;
      padding: 10px;
      text-align: left;
      border: 1px solid #dee2e6;
    }
    th, td {
      padding: 10px;
      border: 1px solid #dee2e6;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tbody tr:nth-child(even) td { background: #f8f9fa; }
    tbody tr:hover td { background: #e9ecef; }

    button.detail {
      padding: 4px 10px;
      border: 1px solid #718096;
      border-radius: 3px;
      background: #fff;
      cursor: pointer;
      font-size: 0.9rem;
      white-space: nowrap;
    }
    button.detail:hover { background: #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Build Results</h1>
    <div id="filterBar">
      <label>Version:</label><select id="versionFilter"></select>
      <label>Host:</label><select id="hostFilter"></select>
      <label>Status:</label><select id="statusFilter"></select>
    </div>
    <button id="refreshBtn">Refresh</button>
    <div class="table-wrapper">
      <table>
	<thead>
	  <tr>
	    <th>Project</th><th>Status</th><th>Test Result</th>
	    <th>Revision</th><th>Code coverage</th><th>Documentation</th>
	    <th>Time start</th><th>Time finish</th><th>Host</th>
	    <th>Build dir</th><th>Builder log</th><th>Compare</th>
	  </tr>
	</thead>
	<tbody id="resultsBody"></tbody>
      </table>
    </div>
  </div>

  <script>
    (async () => {
      const PROJECT_ID = '${projectBranchesId}';
      const API_BASE   = location.origin + '/db/get?id=';
      let builds = [];

      async function fetchBuilds() {
	const branch = await (await fetch(API_BASE + PROJECT_ID)).json();
	const ids = (branch.result_representation || []).slice().reverse();
	builds = [];
	for (const id of ids) {
	  const r = await (await fetch(API_BASE + id)).json();
	  r._id = id;
	  builds.push(r);
	}
      }

      function populateFilters() {
	const ver = document.getElementById('versionFilter');
	const host= document.getElementById('hostFilter');
	const stat= document.getElementById('statusFilter');
	[ver, host, stat].forEach(el => el.innerHTML = '');

	ver.add(new Option('All','All'));
	new
	Set(builds.map(b=>b.name||'Unknown'))
	  .forEach(v=>ver.add(new Option(v,v)));

	host.add(new Option('All','All'));
	new Set(builds.map(b=>b.host||'Unknown'))
	  .forEach(v=>host.add(new Option(v,v)));

	['All','Build failed','Pre-make failed','Failed (manual stop)',
	 'Testing failed','Summarization failed','Documentation failed','Successful']
	 .forEach(s=>stat.add(new Option(s,s)));
      }

      function renderTable() {
	const body = document.getElementById('resultsBody');
	body.innerHTML = '';
	const fV = document.getElementById('versionFilter').value;
	const fH = document.getElementById('hostFilter').value;
	const fS = document.getElementById('statusFilter').value;

	builds.forEach(r => {
	  if ((fV==='All' || r.name===fV) &&
	      (fH==='All' || r.host===fH) &&
	      (fS==='All' || r.status===fS)) {

	    const tr = document.createElement('tr');

	    // helper to append cell
	    const addCell = (content) => {
	      const td = document.createElement('td');
	      if (content instanceof HTMLElement) td.appendChild(content);
	      else td.textContent = content;
	      tr.appendChild(td);
	    };

	    addCell(r.name || '');
	    addCell(r.status || '');

	    // Test Result button
	    const btnTR = document.createElement('button');
	    btnTR.className = 'detail';
	    btnTR.textContent = 'Show details';
	    btnTR.onclick = () => window.open(API_BASE + r.test_result, '_blank');
	    addCell(btnTR);

	    addCell(r.project_revision || '');

	    // Code coverage
	    const btnCov = document.createElement('button');
	    btnCov.className = 'detail';
	    btnCov.textContent = 'Show details';
	    btnCov.onclick = () => window.open(API_BASE + r.code_coverage, '_blank');
	    addCell(btnCov);

	    // Documentation
	    const btnDoc = document.createElement('button');
	    btnDoc.className = 'detail';
	    btnDoc.textContent = 'Show details';
	    btnDoc.onclick = () => window.open(API_BASE + r.documentation, '_blank');
	    addCell(btnDoc);

	    addCell(r.time_start||'');
	    addCell(r.time_finish||'');
	    addCell(r.host||'');

	    // Build dir
	    const btnDir = document.createElement('button');
	    btnDir.className = 'detail';
	    btnDir.textContent = 'Show details';
	    btnDir.onclick = () => window.open(API_BASE + r.build_dir, '_blank');
	    addCell(btnDir);

	    // Builder log
	    const btnLog = document.createElement('button');
	    btnLog.className = 'detail';
	    btnLog.textContent = 'Show details';
	    btnLog.onclick = () => window.open(API_BASE + r.builder_log, '_blank');
	    addCell(btnLog);

	    // Compare
	    const btnCmp = document.createElement('button');
	    btnCmp.className = 'detail';
	    btnCmp.textContent = 'Select';
	    addCell(btnCmp);

	    body.appendChild(tr);
	  }
	});
      }

      document.getElementById('refreshBtn').onclick = async () => {
	await fetchBuilds();
	populateFilters();
	renderTable();
      };

      ['versionFilter','hostFilter','statusFilter']
	.forEach(id => document.getElementById(id).onchange = renderTable);

      // initial
      await fetchBuilds();
      populateFilters();
      renderTable();
    })();
  </script>
</body>
</html>
`;

	// save & open
	const link = await metax.save(html, 'text/html');
	window.open('https://instigate.academy/db/get?id=' + link, '_blank');
}

main();
