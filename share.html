<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GCC Property Report</title>
<style>body{font-family:sans-serif;background:#0d1117;color:#e6e6e6;padding:40px}.loading{text-align:center;padding:80px;opacity:0.5}h2{color:#c9a030}</style>
</head><body><div id="app" class="loading">Loading report…</div>
<script>
const token=location.pathname.split('/share/')[1];
fetch('/api/shares/'+token).then(r=>r.json()).then(data=>{
  if(data.error){document.getElementById('app').innerHTML='<h2>Report not found or expired.</h2>';return;}
  document.title=data.label+' — GCC Report';
  document.getElementById('app').innerHTML=`<h2>${data.label}</h2><p style="opacity:0.5;font-size:0.8rem">Generated ${new Date(data.created_at).toLocaleDateString()} · ${data.view_count} views · Expires ${new Date(data.expires_at).toLocaleDateString()}</p><pre style="background:#161b22;padding:20px;border-radius:8px;overflow:auto;font-size:0.75rem">${JSON.stringify(data.snapshot,null,2)}</pre>`;
}).catch(()=>{document.getElementById('app').innerHTML='<h2>Error loading report.</h2>';});
</script></body></html>
