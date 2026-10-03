'use strict';

const TEXT = {
	zh: {
		navUpdate: '更新', navFeatures: '功能', navInstall: '安装', github: 'GitHub ↗', heroTitle: '让小屏幕，<em>看懂整个设备。</em>',
		heroLede: '一个为荣悦 E5 打造的开源信息屏。网络、热点、流量、短信和设备状态，都在 320×480 的屏幕上清楚可见。',
		heroUpdate: '查看最新版本 ↓', heroSource: '查看源码 ↗', heroMeta: '开源 · OpenWrt · 触摸与键盘',
		updateLabel: '软件更新', latest: '最新版本', loading: '正在读取更新信息…', download: '下载更新包', packageSize: '安装包大小',
		updateSource: '页面和设备读取同一份 JSON；包文件从 Pages 下载。', oldRelease: '查看旧版发布 ↗', updateFailed: '暂时无法读取更新信息，请稍后再试。',
		featuresLabel: '为设备而生', featuresTitle: '重要的状态，一眼就知道。', featuresLede: '信息屏把常用的设备信息放到一个清楚、安静、可操作的界面里。',
		featureNetwork: '网络与信号', featureNetworkText: '5G/4G 制式、频段、信号质量、邻区和签约速率。', featureTraffic: '流量与热点', featureTrafficText: 'WAN、LAN、今日和本月流量，热点二维码和在线设备。',
		featureDevice: '设备状态', featureDeviceText: '电池、电流、电压、温度、内存、存储和联网时间。', featureSms: '短信与应用', featureSmsText: '查看短信，安装插件；应用可以扩展页面、后端和设置。',
		galleryLabel: '屏幕里有什么', galleryTitle: '把关键状态放在眼前。', galleryLede: '沿用现有宣传图里的设备画面，具体内容以当前版本为准。', galleryScreens: '信息屏页面', galleryNetwork: '网络和信号页面', galleryDaily: '日常设备页面', galleryApps: '应用页面', galleryOpen: '开源参与页面', galleryScreensCaption: '九个页面，状态各有位置。', galleryNetworkCaption: '网络、信号和频段。', galleryDailyCaption: '流量、热点和设备日常。', galleryAppsCaption: '应用可以继续扩展。', galleryOpenCaption: '开源，欢迎参与。',
		installLabel: '开始使用', installTitle: '把信息屏装进你的 E5。', installText: '在运行 e5-linux OpenWrt 的设备上执行安装脚本。设备联网后，它会安装依赖、复制页面并启动服务。', installDocs: '查看安装说明 ↗',
		supportLabel: '支持项目', supportTitle: '喜欢这个小屏幕？', supportText: '项目由社区维护。你可以贡献代码、提交应用，或用页面里的赞赏码支持维护。', contribute: '参与贡献 ↗', donateAlt: '赞赏码',
		versionTitle: (v) => `e5-infoscreen ${v}`, noNotes: '此版本没有附加说明。', sizeUnknown: '—', languageLabel: '切换为英文', pageViews: '页面访问', downloadClicks: '更新下载点击'
	},
	en: {
		navUpdate: 'Updates', navFeatures: 'Features', navInstall: 'Install', github: 'GitHub ↗', heroTitle: 'A small screen that <em>understands the whole device.</em>',
		heroLede: 'An open-source info screen for the Rongyue E5. Network, hotspot, traffic, messages and device health, clear on a 320×480 display.',
		heroUpdate: 'See the latest version ↓', heroSource: 'View source ↗', heroMeta: 'Open source · OpenWrt · Touch and keypad',
		updateLabel: 'Software update', latest: 'Latest version', loading: 'Reading update information…', download: 'Download update', packageSize: 'Package size',
		updateSource: 'The page and the device read the same JSON; the package is downloaded from Pages.', oldRelease: 'View older releases ↗', updateFailed: 'The update information is unavailable. Try again later.',
		featuresLabel: 'Built for the device', featuresTitle: 'The important state, at a glance.', featuresLede: 'A clear, quiet and controllable view of the information you reach for most.',
		featureNetwork: 'Network and signal', featureNetworkText: '5G/4G technology, bands, signal quality, neighbours and the subscribed rate.', featureTraffic: 'Traffic and hotspot', featureTrafficText: 'WAN, LAN, today and monthly traffic, hotspot QR and connected clients.',
		featureDevice: 'Device health', featureDeviceText: 'Battery, current, voltage, temperatures, memory, storage and online time.', featureSms: 'Messages and apps', featureSmsText: 'Read messages and install plugins that add pages, backends and settings.',
		galleryLabel: 'Inside the screen', galleryTitle: 'The state you need, in view.', galleryLede: 'Existing promo artwork, kept as a visual guide; the current version remains the source of truth.', galleryScreens: 'Info screen pages', galleryNetwork: 'Network and signal', galleryDaily: 'Everyday device state', galleryApps: 'Apps page', galleryOpen: 'Open source and community', galleryScreensCaption: 'Nine pages, each with a place.', galleryNetworkCaption: 'Network, signal and bands.', galleryDailyCaption: 'Traffic, hotspot and device state.', galleryAppsCaption: 'Extend it with apps.', galleryOpenCaption: 'Open source, open to contributions.',
		installLabel: 'Get started', installTitle: 'Put the info screen on your E5.', installText: 'Run the installer on an E5 running e5-linux OpenWrt. With the WAN up, it installs dependencies, copies the page and starts the service.', installDocs: 'Read installation notes ↗',
		supportLabel: 'Support the project', supportTitle: 'Like this little screen?', supportText: 'The project is maintained by its community. Contribute code, submit an app, or use the QR code to support maintenance.', contribute: 'Contribute ↗', donateAlt: 'Support QR code',
		versionTitle: (v) => `e5-infoscreen ${v}`, noNotes: 'No release notes for this version.', sizeUnknown: '—', languageLabel: '切换为中文', pageViews: 'Page views', downloadClicks: 'Update downloads'
	}
};

const $ = (id) => document.getElementById(id);
let lang = 'zh';
let latest = null;
try { lang = localStorage.getItem('e5-infoscreen-language') === 'en' ? 'en' : 'zh'; } catch (_) {}

function tr(key) { const value = TEXT[lang][key]; return typeof value === 'function' ? value(...Array.prototype.slice.call(arguments, 1)) : value; }
function translate() {
	document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
	document.title = `e5-infoscreen · ${lang === 'zh' ? '荣悦 E5 信息屏' : 'Rongyue E5 info screen'}`;
	document.querySelectorAll('[data-i18n]').forEach((el) => {
		const value = tr(el.dataset.i18n);
		if (['heroTitle'].includes(el.dataset.i18n)) el.innerHTML = value;
		else el.textContent = value;
	});
	document.querySelectorAll('[data-alt]').forEach((el) => { el.alt = tr(el.dataset.alt); });
	$('language').textContent = lang === 'zh' ? 'EN' : '中文';
	$('language').setAttribute('aria-label', tr('languageLabel'));
	if (latest) renderLatest();
}
function size(bytes) { if (!Number.isFinite(bytes)) return tr('sizeUnknown'); if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function renderLatest() {
	const version = latest.version ? `v${latest.version}` : '—';
	$('version').textContent = version;
	$('update-title').textContent = tr('versionTitle', version);
	$('notes').textContent = latest.notes ? (latest.notes[lang] || latest.notes.zh || latest.notes.en || '') : tr('noNotes');
	$('size').textContent = size(Number(latest.size));
	$('sha').textContent = latest.sha256 || '—';
	const link = $('download'); link.href = latest.url; link.classList.remove('disabled'); link.setAttribute('aria-label', `${tr('download')} ${version}`);
}
async function loadLatest() {
	try {
		const response = await fetch('latest.json', { cache: 'no-cache' });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		if (!data || !/^\d+(\.\d+){0,3}$/.test(data.version) || typeof data.url !== 'string' || !/^https?:\/\//.test(data.url) || !/^[a-f0-9]{64}$/i.test(data.sha256 || '')) throw new Error('Invalid update JSON');
		latest = data; renderLatest();
	} catch (_) {
		$('update-title').textContent = tr('updateFailed');
		$('update-error').hidden = false; $('update-error').textContent = tr('updateFailed');
	}
}
function renderStatistics() {
	if (!window.infoscreenStatistics) return;
	$('visit-count').textContent = infoscreenStatistics.count('visits') ?? '—';
	$('download-count').textContent = infoscreenStatistics.count('download:core') ?? '—';
}
document.addEventListener('infoscreen-statistics', renderStatistics);
document.getElementById('download').addEventListener('click', () => { if (latest) infoscreenStatistics.recordDownload(); });
document.getElementById('language').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; try { localStorage.setItem('e5-infoscreen-language', lang); } catch (_) {} translate(); });
translate();
loadLatest();
infoscreenStatistics.start();
renderStatistics();
