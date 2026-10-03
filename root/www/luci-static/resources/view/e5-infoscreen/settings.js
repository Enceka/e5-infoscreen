'use strict';
'require view';
'require form';

return view.extend({
	render: function() {
		var m = new form.Map('e5-infoscreen', '信息屏设置',
			'保存后重启信息屏服务使 enabled、息屏时间、触摸和语言设置生效。更新源和应用商店地址留空时使用默认地址。');
		var s = m.section(form.NamedSection, 'main', 'infoscreen');
		s.addremove = false;

		var o = s.option(form.Flag, 'enabled', '启用信息屏', '关闭后屏幕保持黑屏。');
		o.default = '1'; o.rmempty = false;
		o = s.option(form.Value, 'idle', '自动息屏时间（秒）', '0 表示不自动息屏。');
		o.datatype = 'range(0,86400)'; o.default = '60'; o.rmempty = false;
		o = s.option(form.Value, 'brightness', '亮度', '亮屏时的背光等级。');
		o.datatype = 'range(1,255)'; o.default = '120'; o.rmempty = false;
		o = s.option(form.Flag, 'touch', '启用触摸', '关闭后只响应实体按键。');
		o.default = '1'; o.rmempty = false;
		o = s.option(form.ListValue, 'lang', '语言');
		o.value('zh', '中文'); o.value('en', 'English'); o.default = 'zh'; o.rmempty = false;
		o = s.option(form.Value, 'update_url', '更新 JSON 地址', '留空使用 Pages 的 latest.json；旧设备也可以保留 GitHub Release 地址。');
		o.placeholder = 'https://enceka.github.io/infoscreen/latest.json'; o.rmempty = true;
		o = s.option(form.Value, 'store_url', '应用商店 JSON 地址', '留空使用官方应用商店。');
		o.placeholder = 'https://enceka.github.io/infoscreen-plugins/index.json'; o.rmempty = true;
		return m.render();
	}
});
