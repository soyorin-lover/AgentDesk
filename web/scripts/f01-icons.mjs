import fs from 'node:fs';
const root='E:/Coding project/Claude/agentdesk-web/';
const html=fs.readFileSync('E:/Coding project/AgentDesk/docs/prototypes/workflow-preview.html','utf8');
const at=html.indexOf('"codex":"<svg');
console.log(html.slice(html.lastIndexOf('const ',at),html.lastIndexOf('const ',at)+100));
const start=html.lastIndexOf('{',at); // the brand object has no braces in its SVG values
const end=html.indexOf('};',at)+1;
const icons=JSON.parse(html.slice(start,end));
console.log(Object.keys(icons));
fs.writeFileSync(root+'src/v2/brand-icons.ts','// Lobe Icons, MIT. See docs/licenses/lobe-icons-MIT.txt\nexport const brandIcons = '+JSON.stringify(icons)+';\n');
fs.mkdirSync(root+'docs/licenses',{recursive:true});
fs.copyFileSync('E:/Coding project/AgentDesk/docs/prototypes/licenses/lobe-icons-MIT.txt',root+'docs/licenses/lobe-icons-MIT.txt');
let s=fs.readFileSync(root+'src/v2/icons.tsx','utf8');
s="import {brandIcons} from './brand-icons.ts';\n"+s;
s=s.replace('{mark}\n    </span>',`{(['G','C','D'].includes(mark)) ? <span className="brand-icon" dangerouslySetInnerHTML={{__html:brandIcons[mark === 'G' ? 'codex' : mark === 'C' ? 'claude' : 'deepseek']}}/> : mark}\n    </span>`);
fs.writeFileSync(root+'src/v2/icons.tsx',s);
