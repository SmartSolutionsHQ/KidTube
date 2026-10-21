const $ = s => document.querySelector(s);
const splash = $('#tzs-splash'), dialog = $('#account-dialog');
const appParts = [...document.body.children].filter(el => ![splash,dialog].includes(el) && el.tagName !== 'SCRIPT');
appParts.forEach(el => el.inert = true);
const read = () => {try {const s=JSON.parse(localStorage.getItem('kid-session'));return s?.exp>Date.now()?s:null;}catch{return null;}};
const b64 = s => btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const post = async (path,b) => {const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return r.json();};
function unlock(s) {
 localStorage.setItem('kid-session',JSON.stringify(s)); window.kidUnlocked=true;
 document.body.removeAttribute('data-locked'); appParts.forEach(el=>el.inert=false);
 if(dialog.open)dialog.close(); document.dispatchEvent(new Event('kid:unlocked'));document.dispatchEvent(new Event('tz:enter'));
 $('#account-button').textContent=s.guest?'Guest account':'My account'; $('#tz-reel').focus();
}
async function finishIntro() {
 splash.remove();
 const s=read();
 if(s){
  try {
   const j=s.guest?await post('/api/guest/validate',{token:s.guestToken}):await fetch('/api/check?e='+b64(s.email)+'&t='+encodeURIComponent(s.t||'')).then(r=>r.json());
   if(j.ok&&(s.guest||j.status==='approved'&&j.t)){unlock({...s,role:j.role||s.role});return;}
  }catch{}
 }
 showAccount(new URLSearchParams(location.search).has('register')?'signup':'login');
}
$('#enter-tube').addEventListener('click',finishIntro);

dialog.addEventListener('cancel',e=>{if(!window.kidUnlocked)e.preventDefault();});
$('#account-button').onclick=()=>showAccount('profile');
function showAccount(mode='login',message=''){
 const s=read();const content=$('#account-content');content.replaceChildren();
 const heading=document.createElement('h2');heading.id='account-title';heading.textContent=mode==='signup'?'Join the channel.':mode==='guest'?'Got a guest pass?':mode==='profile'?'Your account.':'Welcome back.';
 content.append(heading);
 if(mode==='profile'&&s){
  const p=document.createElement('p');p.textContent=s.guest?'You’re visiting with a view-only guest pass.':s.email;content.append(p);
  if(s.role==='super'||s.role==='admin'){const a=document.createElement('a');a.href='/parents';a.className='block-button';a.textContent='Open Parent dashboard →';content.append(a);}
  const logout=document.createElement('button');logout.className='block-button';logout.textContent='Log out';logout.onclick=async()=>{await post('/api/logout',{});localStorage.removeItem('kid-session');location.reload();};content.append(logout);
  if(s.guest){const join=document.createElement('button');join.textContent='Create an account';join.className='text-button';join.onclick=()=>showAccount('signup');content.append(join);}
 }else{
  const sub=document.createElement('p');sub.textContent=mode==='signup'?'A parent approves every new account before it can watch.':mode==='guest'?'A one-use code from the family gets you 24 hours of watching.':'Log in to watch, leave a heart, and join the conversation.';content.append(sub);
  const form=document.createElement('form');form.className='join-form';
  const fields=mode==='guest'?[['code','Guest code','text','one-time-code']]:mode==='signup'?[['first','First name','text','given-name'],['last','Last name','text','family-name'],['email','Email','email','email'],['pass','Password (12+ characters)','password','new-password']]:[['email','Email','email','email'],['pass','Password','password','current-password']];
  for(const [name,label,type,autocomplete]of fields){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');Object.assign(input,{name,type,autocomplete,required:true});if(name==='pass'){input.minLength=mode==='signup'?12:1;input.maxLength=128;}if(name==='code'){input.maxLength=4;input.pattern='[a-zA-Z0-9]{4}';}l.append(input);form.append(l);}
  const status=document.createElement('p');status.className='form-status';status.setAttribute('role','status');status.textContent=message;
  const button=document.createElement('button');button.type='submit';button.className='block-button';button.textContent=mode==='signup'?'Request to join →':mode==='guest'?'Use guest pass →':'Log in →';form.append(status,button);content.append(form);
  form.onsubmit=async e=>{
   e.preventDefault();button.disabled=true;status.textContent='One moment…';
   try{
    const b=Object.fromEntries(new FormData(form));if(b.email)b.email=b.email.toLowerCase().trim();

    const j=await post(mode==='guest'?'/api/guest/redeem':mode==='signup'?'/api/signup':'/api/login',b);
    if(!j.ok)throw Error(j.error==='exists'?'That account already exists. Try logging in.':j.error||'Could not connect. Try again.');
    if(mode==='signup'){showAccount('login','Request received! Once a parent approves your account, log in here.');return;}
    if(mode==='guest'){unlock({guest:true,guestToken:j.token,role:'guest',exp:j.expires});return;}
    if(j.status!=='approved'){status.textContent=j.status==='pending'?'Your account is waiting for parent approval.':'This account has not been approved.';return;}
    unlock({email:b.email,t:j.t,role:j.role,exp:Date.now()+7*86400000});
   }catch(err){status.textContent=err.message;}finally{button.disabled=false;}
  };
  const choices=document.createElement('div');choices.className='account-choices';
  for(const [v,t]of [['login','Log in'],['signup','Create account'],['guest','Guest pass']]){if(v===mode)continue;const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=t;b.onclick=()=>showAccount(v);choices.append(b);}content.append(choices);
 }
 const footer=document.createElement('div');footer.className='account-choices';footer.innerHTML='<a href="/about">About the channel ↗</a>';
 if(window.kidUnlocked){const close=document.createElement('button');close.textContent='Back to videos';close.className='text-button';close.onclick=()=>dialog.close();footer.append(close);}content.append(footer);
 if(!dialog.open)dialog.showModal();
}
