// Pull every PPM contract + its Tags from the Joblogic web app (the public API has no contract tags).
// Run inside a logged-in https://go.joblogic.com/PPMContract tab (needs the page's __RequestVerificationToken).
// Runs async; progress/result go on <html> attributes because Control Chrome's execute_javascript runs in an
// isolated world and can't await: poll data-cc-probe until it starts with "DONE", then read data-cc-ppm.
// SelectedTab 4 = "All" (1 = Active only, 2/3 = completed/cancelled). PageSize is capped at 50 server-side.
// Output row: [UniqueId, PPMContractNumber, Tags, IsCancelled, JobCategory, PlanReference, CustomerName,
//              SiteName, StartDate, EndDate] -> load_ppm_contract_tags.py
(async () => {
  const put = v => document.documentElement.setAttribute('data-cc-probe', v);
  document.documentElement.removeAttribute('data-cc-ppm');
  put('running');
  try {
    const tok = document.querySelector('input[name="__RequestVerificationToken"]').value;
    const all = []; let total = null;
    for (let page = 1; page < 100; page++) {
      const p = new URLSearchParams({SearchTerm: '', PageNumber: String(page), PageIndex: String(page),
        PageSize: '50', SelectedTab: '4', IncludeCompleted: 'true', IncludeCancelled: 'true'});
      let r;
      for (let attempt = 1; attempt <= 4; attempt++) {  // Azure WAF throws intermittent 403s on bursts
        r = await fetch('/api/PPMContract/SearchPPMContract', {method: 'POST', body: p, credentials: 'include',
          headers: {'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': tok}});
        if (r.ok) break;
        await new Promise(res => setTimeout(res, 5000 * attempt));
      }
      if (!r.ok) { put('ERR HTTP ' + r.status + ' page ' + page); return; }
      const ad = (await r.json()).AdditionalData;
      total = ad.TotalCount;
      const rows = ad.PPMContracts || [];
      for (const c of rows) all.push([c.UniqueId, c.PPMContractNumber, c.Tags, c.IsCancelled, c.JobCategory,
        c.PlanReference, c.CustomerName, c.SiteName, c.StartDate, c.EndDate]);
      put('page ' + page + ' got ' + all.length + '/' + total);
      if (!rows.length || all.length >= total) break;
      await new Promise(res => setTimeout(res, 1400));
    }
    document.documentElement.setAttribute('data-cc-ppm', JSON.stringify(all));
    put('DONE ' + all.length + '/' + total);
  } catch (e) { put('ERR ' + e); }
})();
'started';
