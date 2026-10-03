'use strict';
import { writefile, readfile } from 'fs';
let response='', body='{}', received=false;
global.uhttpd={send:s=>{response+=s;},recv:n=>{if(received)return '';received=true;return body;},urldecode:s=>s};
loadfile('/usr/share/e5-infoscreen/api.uc',{raw_mode:false})();
function request(path,method,data){
 response='';received=false;body=sprintf('%J',data??{});
 global.handle_request({PATH_INFO:path,REQUEST_METHOD:method??'GET',CONTENT_LENGTH:length(body)});
 let i=index(response,'\r\n\r\n');assert(i>=0,'missing response');return json(substr(response,i+4));
}
let r=request('/plugins/fixture/_notify','POST',{id:'job',title:{zh:'任务完成',en:'Done'},body:'hello',wake:false});
assert(r.ok,'publish failed');
r=request('/notifications');assert(length(r.notifications)==2,'missing provider or published notice');
assert(!readfile('/tmp/forbidden-action'),'poll invoked an action');
assert(request('/plugins/missing/_notify','POST',{id:'bad'}).error,'unknown plugin accepted');
assert(request('/plugins/fixture/_notify','POST',{id:'job',clear:true}).ok,'clear failed');
r=request('/notifications');assert(length(r.notifications)==1,'clear did not remove notice');
assert(r.notifications[0].plugin=='fixture','wrong namespace');
print('Generic notification API checks passed\n');
