require('dotenv').config({path:'/Users/bot/peasy-auto/.env'});
const BASE='https://api.biladministrasjon.no';
const REGNR='BU39939';

const authH=t=>({Authorization:`Bearer ${t}`,Accept:'application/json'});

(async()=>{
  // 1. Login
  const loginRes=await fetch(`${BASE}/auth/login`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:process.env.ERP_USER,password:process.env.ERP_PASS})
  });
  const loginData=await loginRes.json();
  const token=loginData.data?.token?.token;
  if(!token){console.error('LOGIN FEIL:',JSON.stringify(loginData).slice(0,200));return;}
  console.log('Login OK');

  // 2. Finn bil i final_estimate-listen
  const listRes=await fetch(`${BASE}/c2b_module/peasy/processing/final_estimate?per_page=100`,{headers:authH(token)});
  const listData=await listRes.json();
  console.log("listKeys:", Object.keys(listData).slice(0,10));
  const inner=listData.data?.data; console.log("inner type:", typeof inner, "isArray:", Array.isArray(inner), "keys:", Object.keys(inner||{}).slice(0,15)); const cars=Array.isArray(inner)?inner:(inner?.data||[]);
  console.log("cars len:", cars.length, "isArray:", Array.isArray(cars));
  const car=cars.find(c=>c.regnr===REGNR||c.reg_nr===REGNR||c.registration_number===REGNR);
  if(!car){console.error('Fant ikke',REGNR,'i listen. Antall biler:',cars.length);console.log('F\xf8rste bil keys:',Object.keys(cars[0]||{}).slice(0,20));return;}
  console.log('Fant bil. ERP-ID:',car.id,'regnr:',car.regnr||car.reg_nr);

  // 3. Hent detalj for å få alle felter
  const detRes=await fetch(`${BASE}/c2b_module/peasy/cars/${car.id}`,{headers:authH(token)});
  const detData=await detRes.json();
  const det=detData.data||detData;
  console.log('Detalj OK. price_final_min:',det.price_final_min,'max:',det.price_final_max,'auction_type:',det.auction_price_type_id);

  // 4. Bygg payload basert på eksisterende data + change_status:true
  const today=new Date();
  const dd=String(today.getDate()).padStart(2,'0');
  const mm=String(today.getMonth()+1).padStart(2,'0');
  const dateStr=`${dd}.${mm}.${today.getFullYear()}`;
  
  const enc=det.encumbrance||{};
  const payload={
    price_final_min:det.price_final_min,
    price_final_max:det.price_final_max,
    auction_price_type_id:det.auction_price_type_id,
    encumbrance:{
      check_date:enc.check_date||dateStr,
      comment:enc.comment||'',
      debt_date:enc.debt_date||dateStr,
      amount:enc.amount||0,
      account_number:enc.account_number||'0',
      reference:enc.reference||'0',
      contact_information:enc.contact_information||'0',
      contact_person:enc.contact_person||'',
      any_debts:enc.any_debts||false,
      checkmark:true,
      ...(enc.id?{id:enc.id}:{})
    },
    owners_check_comment:null,
    owners_check_date:det.owners_check_date||dateStr,
    change_status:true   // <- DET SOM TRIGGER E-POST + SMS
  };
  console.log('Payload klar. change_status:',payload.change_status);
  console.log('Payload:',JSON.stringify(payload).slice(0,300));

  // 5. PUT - send eval
  const putRes=await fetch(`${BASE}/c2b_module/peasy/processing/update/${car.id}/final_estimate/confirm`,{
    method:'POST',
    headers:{...authH(token),'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const putData=await putRes.json();
  console.log('Status:',putRes.status);
  console.log('Response:',JSON.stringify(putData).slice(0,400));
})();
