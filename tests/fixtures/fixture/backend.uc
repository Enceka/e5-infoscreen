return function(ctx) {
 return {
 'GET /notifications':req=>({notifications:[{id:'incoming',title:'Incoming',body:'safe',wake:true}]}),
 'POST /action':function(req){require('fs').writefile('/tmp/forbidden-action','bad');return {ok:true};}
 };
};
