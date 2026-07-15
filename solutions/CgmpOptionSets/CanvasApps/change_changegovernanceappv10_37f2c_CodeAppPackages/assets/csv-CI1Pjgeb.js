function l(e){const r=[];let t="",c=!1;for(let n=0;n<e.length;n++){const s=e[n];s==='"'?c&&e[n+1]==='"'?(t+='"',n++):c=!c:s===","&&!c?(r.push(t.trim()),t=""):t+=s}return r.push(t.trim()),r}function u(e){return e.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`).filter(t=>t.trim()).map(l)}function p(e){return/[",\n\r]/.test(e)?`"${e.replace(/"/g,'""')}"`:e}function a(e,r,t){const c=[r,...t].map(i=>i.map(p).join(",")),n=new Blob([c.join(`
`)],{type:"text/csv;charset=utf-8;"}),s=URL.createObjectURL(n),o=document.createElement("a");o.href=s,o.download=e.endsWith(".csv")?e:`${e}.csv`,document.body.appendChild(o),o.click(),document.body.removeChild(o),URL.revokeObjectURL(s)}export{a as e,u as p};
