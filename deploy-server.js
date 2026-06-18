const http = require('http');
const {execSync, spawn} = require('child_process');
const PORT = 9876;
const BOT_DIR = process.env.HOME + '/peasy-auto';
const NODE = '/Users/bot/.nvm/versions/node/v24.14.0/bin/node';
const SECRET = 'peasy-deploy-2026';
function deploy() {
  try {
    execSync('cd '+BOT_DIR+' && git fetch origin && git reset --hard origin/main', {stdio:'inherit'});
    execSync('killall node 2>/dev/null || true');
    setTimeout(() => {
      const child = spawn(NODE, ['peasy-auto.js'], {cwd:BOT_DIR, detached:true, stdio:['ignore', fs.openSync(BOT_DIR+'/logs/out.log','a'), fs.openSync(BOT_DIR+'/logs/out.log','a')]});
      child.unref();
    }, 3000);
  } catch(e) { console.error(e.message); }
}
http.createServer((req,res) => {
  if (req.method==='POST' && req.url==='/deploy' && req.headers['x-deploy-secret']===SECRET) {
    res.writeHead(200); res.end('OK'); deploy();
  } else { res.writeHead(200); res.end('OK'); }
}).listen(PORT, () => console.log('deploy-server lytter pa port '+PORT));
