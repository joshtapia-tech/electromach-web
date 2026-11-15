document.getElementById('year').textContent=new Date().getFullYear();
document.querySelectorAll('[data-service]').forEach(link=>link.addEventListener('click',()=>{document.getElementById('service').value=link.dataset.service;}));
let brief='';
document.getElementById('brief').addEventListener('submit',event=>{event.preventDefault();brief=`Hola Electromach, soy ${document.getElementById('name').value.trim()}.\nServicio: ${document.getElementById('service').value}.\n\n${document.getElementById('message').value.trim()}`;document.getElementById('summary').textContent=brief;document.getElementById('result').hidden=false;});
document.getElementById('download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([brief],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='consulta-electromach.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
