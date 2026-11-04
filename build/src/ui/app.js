'use strict';
// goodseedown 화면. 모든 글자는 textContent 로만 넣는다(영상 제목 등 외부 문자열이 HTML 로 해석되지 않게).
(() => {
  const gsd = window.gsd;
  const $ = s => document.querySelector(s);
  const state = { settings: null, jobs: new Map(), subs: [], tab: 'downloads', mode: 'video' };

  // ---------- 작은 도구 ----------
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') e[k] = !!v; else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const fmtDur = s => { if (!Number.isFinite(s) || s <= 0) return ''; s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
  const fmtBytes = n => !Number.isFinite(n) || n === null ? '' : n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const fmtSpeed = n => (Number.isFinite(n) && n > 0 ? fmtBytes(n) + '/s' : '');
  const fmtEta = s => (Number.isFinite(s) && s >= 0 ? '남은 시간 ' + fmtDur(Math.max(1, s)) : '');
  const fmtTime = t => { if (!t) return '아직 확인 안 함'; const d = new Date(t); return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const QUALITY_LABEL = { best: '최대 화질(8K까지)', 4320: '8K (4320p)', 2160: '4K (2160p)', 1440: '1440p', 1080: '1080p (Full HD)', 720: '720p (HD)', 480: '480p', 360: '360p', 240: '240p' };
  const STATUS_LABEL = { queued: '대기 중', downloading: '받는 중', processing: '처리 중', paused: '일시정지', completed: '완료', failed: '실패', canceled: '취소됨' };
  const STAGE_LABEL = { video: '영상 받는 중', audio: '음성 받는 중', merge: '영상·음성 합치는 중', convert: '오디오 변환 중', subs: '자막 처리 중', finish: '마무리 중' };

  function toast(text, kind = 'info', ms = 4500) {
    const t = h('div', { class: 'toast ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : ''), text });
    $('#toasts').append(t); setTimeout(() => t.remove(), ms);
  }

  // ---------- 모달 ----------
  function openModal(build) {
    const root = $('#modalRoot'); const prevFocus = document.activeElement;
    const overlay = h('div', { class: 'overlay' }); root.append(overlay);
    const close = () => { overlay.remove(); try { prevFocus && prevFocus.focus(); } catch { } };
    const dlg = build(close); overlay.append(dlg);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.dataset.nocancel !== '1') { e.stopPropagation(); close(); dlg.dispatchEvent(new Event('gs-cancel')); } });
    const first = dlg.querySelector('[data-autofocus]') || dlg.querySelector('button.primary') || dlg.querySelector('button'); first && first.focus();
    return close;
  }
  const confirmBox = (title, message, okText = '확인', cancelText = '취소') => new Promise(res => {
    openModal(close => {
      const d = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: 'width:min(520px,100%)' },
        h('header', {}, h('div', { class: 't' }, h('b', { text: title }))),
        h('div', { class: 'body' }, ...String(message).split('\n').map(l => h('p', { text: l, style: 'margin:4px 0' }))),
        h('footer', {}, h('button', { type: 'button', text: cancelText, onclick: () => { close(); res(false); } }), h('button', { type: 'button', class: 'primary', 'data-autofocus': '1', text: okText, onclick: () => { close(); res(true); } })));
      d.addEventListener('gs-cancel', () => res(false));
      return d;
    });
  });

  // ---------- 옵션 폼(설정 화면의 다운로드 기본값) ----------
  const SUB_PRESETS = [['ko', '한국어'], ['en', '영어'], ['ja', '일본어'], ['zh-Hans', '중국어(간체)'], ['es', '스페인어'], ['fr', '프랑스어'], ['de', '독일어']];
  function seg(name, items, value, onchange) {
    const box = h('div', { class: 'seg', role: 'radiogroup' });
    for (const [v, label] of items) {
      const inp = h('input', { type: 'radio', name, value: v, checked: v === value, id: `${name}-${v}` });
      inp.addEventListener('change', () => onchange(v));
      box.append(h('label', {}, inp, label));
    }
    return box;
  }
  // 옵션 객체(o)를 직접 고치는 폼
  function buildOptionsForm(o, { idp = 'def', onChange = () => { } } = {}) {
    const wrap = h('div', { class: 'optform' });
    const changed = () => { render(); onChange(); };
    const kindBox = seg(idp + '-kind', [['video', '영상'], ['audio', '음성만'], ['subs', '자막만']], o.kind, v => { o.kind = v; if (v === 'subs') o.subs.enabled = true; changed(); });
    const quality = h('select', { id: idp + '-quality', 'aria-label': '화질' }, ...Object.entries(QUALITY_LABEL).map(([v, l]) => h('option', { value: v, text: l, selected: v === o.quality })));
    quality.addEventListener('change', () => { o.quality = quality.value; onChange(); });
    const vfmt = seg(idp + '-vfmt', [['mp4', 'MP4'], ['mkv', 'MKV']], o.videoFormat, v => { o.videoFormat = v; onChange(); });
    const afmt = seg(idp + '-afmt', [['mp3', 'MP3'], ['m4a', 'M4A'], ['ogg', 'OGG']], o.audioFormat, v => { o.audioFormat = v; render(); onChange(); });
    const bitrate = h('select', { id: idp + '-mp3q', 'aria-label': 'MP3 음질' }, ...[128, 192, 256, 320].map(v => h('option', { value: v, text: v + ' kbps' + (v === 320 ? ' (최고)' : ''), selected: v === Number(o.mp3Bitrate) })));
    bitrate.addEventListener('change', () => { o.mp3Bitrate = Number(bitrate.value); onChange(); });
    const bitrateWrap = h('span', {}, h('span', { class: 'lbl', text: 'MP3 음질', style: 'min-width:auto;margin:0 8px 0 10px' }), bitrate);
    const id3On = h('input', { type: 'checkbox', id: idp + '-id3', checked: o.id3 !== false }); id3On.addEventListener('change', () => { o.id3 = id3On.checked; onChange(); });
    const subsOn = h('input', { type: 'checkbox', id: idp + '-subs-on', checked: o.subs.enabled }); subsOn.addEventListener('change', () => { o.subs.enabled = subsOn.checked; changed(); });
    const autoOn = h('input', { type: 'checkbox', id: idp + '-subs-auto', checked: o.subs.auto }); autoOn.addEventListener('change', () => { o.subs.auto = autoOn.checked; changed(); });
    const chipsBox = h('div', { class: 'chips', id: idp + '-subs-chips' });
    const extra = h('input', { type: 'text', id: idp + '-subs-extra', placeholder: '예: ko,en,ja', style: 'width:200px', 'aria-label': '자막 언어 코드 직접 입력' });
    const presetLangs = new Set(SUB_PRESETS.map(p => p[0]));
    extra.value = o.subs.langs.filter(l => !presetLangs.has(l)).join(',');
    extra.addEventListener('input', () => { syncLangs(); onChange(); });
    const modeSeg = h('div');
    const subsArea = h('div', { id: idp + '-subs-area' });
    const checked = new Set(o.subs.langs);
    function syncLangs() {
      const extras = extra.value.split(/[\s,]+/).map(s => s.trim()).filter(s => /^[A-Za-z0-9][A-Za-z0-9._-]{0,24}$/.test(s));
      const fromChips = [...chipsBox.querySelectorAll('input:checked')].map(i => i.value);
      o.subs.langs = [...new Set([...fromChips, ...extras])].slice(0, 20);
    }
    function buildChips() {
      chipsBox.replaceChildren();
      const seen = new Set();
      const add = (code, label) => { if (seen.has(code)) return; seen.add(code); const i = h('input', { type: 'checkbox', value: code, checked: checked.has(code) || o.subs.langs.includes(code) }); i.addEventListener('change', () => { syncLangs(); onChange(); }); chipsBox.append(h('label', { title: code }, i, label)); };
      for (const [c, l] of SUB_PRESETS) add(c, l);
    }
    function render() {
      subsArea.hidden = false;
      wrap.querySelectorAll('[data-for]').forEach(n => { n.hidden = !n.dataset.for.split(' ').includes(o.kind); });
      modeSeg.replaceChildren(seg(idp + '-submode', o.kind === 'video' ? [['srt', 'SRT 파일로 저장'], ['embed', '영상에 합치기(소프트 자막)'], ['both', '둘 다']] : [['srt', 'SRT 파일로 저장']], o.kind === 'video' ? o.subs.mode : 'srt', v => { o.subs.mode = v; onChange(); }));
      subsArea.querySelector('.subs-body').hidden = !(o.subs.enabled || o.kind === 'subs');
      subsOn.disabled = o.kind === 'subs';
      bitrateWrap.hidden = o.audioFormat !== 'mp3';
    }
    buildChips();
    subsArea.append(
      h('div', { class: 'field' }, h('label', { class: 'lbl', for: idp + '-subs-on', text: '자막' }), h('label', {}, subsOn, ' 자막도 함께 받기')),
      h('div', { class: 'subs-body' },
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: '언어' }), chipsBox),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: '다른 언어 코드' }), extra, h('label', {}, autoOn, ' 자동 생성 자막 포함')),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: '저장 방식' }), modeSeg)));
    wrap.append(
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: '종류' }), kindBox),
      h('div', { class: 'field', 'data-for': 'video' }, h('label', { class: 'lbl', for: idp + '-quality', text: '화질' }), quality, h('span', { class: 'lbl', text: '형식', style: 'min-width:auto;margin-left:10px' }), vfmt),
      h('div', { class: 'field', 'data-for': 'audio' }, h('span', { class: 'lbl', text: '음성 형식' }), afmt, bitrateWrap),
      h('div', { class: 'field', 'data-for': 'audio' }, h('span', { class: 'lbl', text: '태그' }), h('label', {}, id3On, ' 제목·아티스트 태그를 넣고, MP3 는 앨범 사진도 넣기')),
      subsArea);
    render();
    return wrap;
  }
  const optionSummary = o => {
    if (o.kind === 'audio') return o.audioFormat === 'mp3' ? `MP3 ${Number(o.mp3Bitrate) || 320}kbps 음성` : o.audioFormat.toUpperCase() + ' 음성';
    const subs = o.subs.enabled && o.subs.langs.length ? ` · 자막 ${o.subs.langs.join(',')}${o.kind === 'video' && o.subs.mode !== 'srt' ? '(합침)' : ''}` : '';
    if (o.kind === 'subs') return '자막만' + subs.replace(' · 자막', '');
    return `${o.videoFormat.toUpperCase()} · ${o.quality === 'best' ? '최대 화질' : o.quality + 'p'}${subs}`;
  };
  const cloneOpts = o => JSON.parse(JSON.stringify(o));

  // ---------- 다운로드: 링크 → 곧바로 대기열 ----------
  // ★자동 다운로드 없음(오너 지시): 아래는 사용자가 직접 붙여넣은 링크를 [다운로드]/[MP3 받기](또는 Enter)로 제출했을 때만 실행된다.
  const LIST_CAP = 500; // 재생목록·채널에서 한 번에 읽는 최대 영상 수
  let busyCancel = null;
  function setBusy(text, onCancel) {
    const on = !!text;
    $('#busy').hidden = !on; $('#busyText').textContent = on ? text : '';
    busyCancel = on && onCancel ? onCancel : null; $('#btnBusyCancel').hidden = !busyCancel;
    for (const id of ['#btnGo', '#btnSubscribe', '#mp3Go']) $(id).disabled = on;
  }
  async function afterAdd(res, label) {
    const n = res.added.length, skipped = res.skipped.length;
    toast(n ? `${label}${n}개를 대기열에 추가했습니다.${skipped ? ` (이미 있거나 주소가 올바르지 않은 ${skipped}개는 건너뜀)` : ''}` : `추가할 항목이 없습니다.${skipped ? ' 이미 대기열에 있습니다.' : ''}`, n ? 'ok' : 'info');
    if (n) setTab('downloads');
  }
  const extractFromText = async text => { const m = String(text).match(/https?:\/\/[^\s<>"'`]+/g); return m ? [...new Set(m)] : []; };
  const videoOnlyUrl = u => { try { const x = new URL(u); for (const k of ['list', 'index', 'start_radio']) x.searchParams.delete(k); return x.href; } catch { return u; } };
  const listOnlyUrl = u => 'https://www.youtube.com/playlist?list=' + encodeURIComponent(new URL(u).searchParams.get('list') || '');
  const askVideoOrList = () => new Promise(res => openModal(close => {
    const d = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': '영상 또는 재생목록', id: 'dlgChoice', style: 'width:min(520px,100%)' },
      h('header', {}, h('div', { class: 't' }, h('b', { text: '영상과 재생목록 주소가 함께 있습니다' }))),
      h('div', { class: 'body' }, h('p', { text: '이 링크는 영상 한 개와 그 영상이 들어 있는 재생목록 정보를 모두 담고 있어요. 어떻게 받을까요?' })),
      h('footer', {}, h('button', { type: 'button', text: '취소', onclick: () => { close(); res(null); } }),
        h('button', { type: 'button', id: 'btnChoiceVideo', text: '이 영상만', onclick: () => { close(); res('video'); } }),
        h('button', { type: 'button', id: 'btnChoiceList', class: 'primary', text: '재생목록 전체', onclick: () => { close(); res('list'); } })));
    d.addEventListener('gs-cancel', () => res(null));
    return d;
  }));
  // 재생목록·채널·다른 사이트 링크는 목록(영상 정보)만 읽는다. 취소하거나 실패하면 null(실패는 알림).
  async function fetchInfo(url, mode) {
    let cancelled = false;
    setBusy('링크의 영상 목록을 읽는 중… (재생목록·채널은 조금 걸릴 수 있어요)', () => { cancelled = true; gsd.cancelAnalyze(); });
    let r;
    try { r = await gsd.analyze(url, { mode, end: LIST_CAP }); } finally { setBusy(null); }
    if (cancelled) return null;
    if (!r.ok) { if (r.code !== 'aborted') toast(r.error, 'err', 7000); return null; }
    return r.result;
  }
  // 링크 하나를 prof(옵션·저장 폴더·재생목록 정리 방식)로 대기열에 넣는다. 넣지 않았으면 null.
  async function queueLink(url, prof) {
    const add = req => gsd.addDownloads({ options: prof.options, saveDir: prof.saveDir, ...req });
    const cls = await gsd.classify(url);
    const yt = cls && cls.site === 'youtube';
    // YouTube 영상 한 개: 목록을 읽을 필요 없이 바로 대기열에(제목은 받기 시작하면 채워진다)
    if (yt && cls.kind === 'video') return add({ items: [{ url }] });
    let mode = 'auto';
    if (yt && cls.kind === 'choice') {
      mode = await askVideoOrList(); if (!mode) return null;
      if (mode === 'video') return add({ items: [{ url: videoOnlyUrl(url) }] });
    }
    const res = await fetchInfo(url, mode);
    if (!res) return null;
    if (res.type === 'playlist') {
      const entries = res.entries.filter(e => !e.unavailable);
      if (!entries.length) { toast('받을 수 있는 영상이 없습니다.', 'err'); return null; }
      if (entries.length > 50 && !(await confirmBox('영상이 많아요', `'${res.title}' 에서 영상 ${entries.length}개를 모두 받을까요?\n${prof.what} 로 받습니다.`, `${entries.length}개 모두 받기`))) return null;
      if (res.count > res.entries.length) toast(`목록이 길어 처음 ${res.entries.length}개만 넣습니다(전체 ${res.count}개).`, 'info', 7000);
      return add({ items: entries.map(e => ({ url: e.url, title: e.title, duration: e.duration, index: e.index })), subfolder: prof.subfolder ? res.title : '', indexPrefix: prof.indexPrefix, source: { type: 'playlist', id: res.id, title: res.title } });
    }
    if (res.type === 'video') return add({ items: [{ url: res.url || url, title: res.title, duration: res.duration }] });
    toast('링크를 해석하지 못했습니다. 영상 또는 재생목록 링크를 넣어 주세요.', 'err');
    return null;
  }
  // 입력칸의 링크(여러 개면 모두, 최대 20개)를 차례로 넣는다. 하나라도 넣었으면 입력칸을 비운다.
  async function submitLinks(input, prof) {
    const raw = input.value;
    const urls = await extractFromText(raw);
    if (!urls.length) return toast(raw.trim() ? '올바른 http(s) 링크가 아닙니다.' : '링크를 입력해 주세요.', 'err');
    let any = false;
    for (const u of urls.slice(0, 20)) { const r = await queueLink(u, prof); if (r) { any = true; afterAdd(r, prof.label); } }
    if (any) input.value = '';
  }
  // 동영상 화면: 입력창 옆 형식·화질(= 설정의 다운로드 기본값)으로 받는다.
  function videoProfile() {
    const s = state.settings, o = s.defaults;
    return { options: o, saveDir: s.saveDir, subfolder: s.playlistSubfolder, indexPrefix: s.playlistNumberPrefix, label: o.kind === 'audio' ? (o.audioFormat === 'mp3' ? 'MP3 ' : '음성 ') : o.kind === 'subs' ? '자막 ' : '영상 ', what: optionSummary(o) };
  }

  // ---------- 형식·화질(입력창 옆) — 설정 화면의 다운로드 기본값과 같은 값을 쓴다 ----------
  const INLINE_VQ = [['best', '최고'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']];
  const INLINE_AQ = [320, 256, 192, 128];
  const inlineKind = d => (d.kind === 'video' ? 'video' : d.kind === 'audio' && d.audioFormat === 'mp3' ? 'mp3' : 'custom');
  let inlineSaving = Promise.resolve();
  function applyInline() {
    const d = state.settings.defaults, k = inlineKind(d);
    const kinds = [['video', '영상 ' + d.videoFormat.toUpperCase()], ['mp3', 'MP3 음악']];
    if (k === 'custom') kinds.push(['custom', '설정값: ' + optionSummary(d)]); // 설정 화면에서 고른 자막만·M4A 등
    $('#dlKind').replaceChildren(...kinds.map(([v, l]) => h('option', { value: v, text: l, selected: v === k })));
    let q = [];
    if (k === 'video') { q = INLINE_VQ.slice(); if (!q.some(x => x[0] === d.quality)) q.push([d.quality, QUALITY_LABEL[d.quality] || d.quality + 'p']); }
    else if (k === 'mp3') q = INLINE_AQ.map(v => [String(v), v + 'kbps']);
    const cur = k === 'mp3' ? String(d.mp3Bitrate) : d.quality;
    $('#dlQuality').replaceChildren(...q.map(([v, l]) => h('option', { value: v, text: l, selected: v === cur })));
    $('#dlQualityLbl').textContent = k === 'mp3' ? '음질' : '화질';
    $('#dlQualityWrap').hidden = k === 'custom';
  }
  const saveInline = patch => { inlineSaving = gsd.setSettings({ defaults: patch }).then(s => { state.settings = s; applyInline(); }).catch(err => toast('설정 저장 오류: ' + err.message, 'err')); return inlineSaving; };

  // ---------- 구독하기: 붙여넣은 재생목록·채널 링크를 바로 구독(지금 있는 영상은 '본 영상'으로 기록만 하고 받지 않음) ----------
  async function subscribeLink() {
    const raw = $('#url').value;
    const urls = await extractFromText(raw);
    if (!urls.length) return toast(raw.trim() ? '올바른 http(s) 링크가 아닙니다.' : '구독할 재생목록·채널 링크를 입력해 주세요.', 'err');
    let url = urls[0];
    const cls = await gsd.classify(url);
    if (cls && cls.site === 'youtube' && cls.kind === 'video') return toast('영상 한 개의 링크는 구독할 수 없습니다. 재생목록이나 채널 링크를 넣어 주세요.', 'err', 6000);
    if (cls && cls.site === 'youtube' && cls.kind === 'choice') url = listOnlyUrl(url);
    await inlineSaving;
    setBusy('구독할 목록을 확인하는 중… (지금 있는 영상은 받지 않고 기록만 합니다)');
    let r;
    try { r = await gsd.subs.add({ url, options: state.settings.defaults, saveDir: state.settings.saveDir }); } finally { setBusy(null); }
    if (!r.ok) return toast(r.error, 'err', 7000);
    $('#url').value = '';
    toast(`'${r.sub.title}' 을(를) 구독했습니다. 새 영상이 올라오면 알려 드립니다(자동으로 받지는 않아요).`, 'ok');
    setTab('subs');
  }

  // ---------- 다운로드 목록 ----------
  const nodes = new Map();
  const isMp3Job = j => !!(j.options && j.options.kind === 'audio' && j.options.audioFormat === 'mp3');
  function jobActions(j) {
    const b = (act, text, cls = '') => h('button', { type: 'button', class: 'small ' + cls, 'data-act': act, text, onclick: () => jobAct(act, j.id) });
    switch (j.status) {
      case 'queued': case 'downloading': case 'processing': return [b('pause', '일시정지'), b('cancel', '취소', 'danger')];
      case 'paused': return [b('resume', '이어받기', 'primary'), b('cancel', '취소', 'danger')];
      case 'failed': return [b('retry', '다시 시도', 'primary'), b('remove', '목록에서 삭제')];
      case 'canceled': return [b('retry', '다시 시작'), b('remove', '목록에서 삭제')];
      case 'completed': return [b('open', '열기', 'primary'), b('folder', '폴더에서 보기'), b('remove', '목록에서 삭제')];
      default: return [];
    }
  }
  async function jobAct(act, id) {
    if (act === 'open') { const ok = await gsd.openFile(id); if (!ok) toast('파일을 열 수 없습니다. 이동했거나 삭제되었을 수 있어요.', 'err'); return; }
    if (act === 'folder') { const ok = await gsd.openFolder(id); if (!ok) toast('폴더를 열 수 없습니다.', 'err'); return; }
    if (act === 'cancel') { const j = state.jobs.get(id); if (j && j.status !== 'queued' && !(await confirmBox('다운로드 취소', '받던 내용(임시 파일)을 지우고 취소할까요?', '취소하기', '계속 받기'))) return; }
    await gsd.job(act, id);
  }
  function renderJob(j) {
    let n = nodes.get(j.id);
    if (!n) {
      n = { el: h('div', { class: 'job', 'data-id': j.id }), sig: '' };
      n.el.append(h('div', { class: 'row1' }, h('div', { class: 'title' }), h('span', { class: 'chip' })), h('div', { class: 'meta' }), h('div', { class: 'bar' }, h('i')), h('div', { class: 'prog' }, h('span', { class: 'p1' }), h('span', { class: 'p2' })), h('div', { class: 'msg' }), h('div', { class: 'acts' }));
      nodes.set(j.id, n);
    }
    const e = n.el, p = j.progress || {};
    e.dataset.status = j.status; e.dataset.mp3 = isMp3Job(j) ? '1' : '0';
    const title = e.querySelector('.title'); title.textContent = j.title; title.title = j.url;
    e.querySelector('.chip').textContent = j.status === 'processing' ? (STAGE_LABEL[p.stage] || '처리 중') : STATUS_LABEL[j.status] || j.status;
    e.querySelector('.meta').textContent = [j.uploader, fmtDur(j.duration), optionSummary(j.options), j.source && j.source.type === 'subscription' ? '구독: ' + j.source.title : j.source && j.source.type === 'playlist' ? '재생목록: ' + j.source.title : ''].filter(Boolean).join(' · ');
    const bar = e.querySelector('.bar'), fill = bar.querySelector('i');
    const active = j.status === 'downloading' || j.status === 'processing';
    const pct = j.status === 'completed' ? 100 : Number.isFinite(p.percent) ? p.percent : null;
    bar.classList.toggle('indet', active && pct === null);
    fill.style.width = pct === null ? '' : pct.toFixed(1) + '%';
    const left = j.status === 'completed' ? '100%' : pct !== null ? Math.floor(pct) + '%' : (active ? '준비 중…' : '');
    e.querySelector('.p1').textContent = [left, j.status === 'downloading' ? STAGE_LABEL[p.stage] : '', p.total ? `${fmtBytes(p.downloaded)} / ${fmtBytes(p.total)}` : ''].filter(Boolean).join(' · ');
    e.querySelector('.p2').textContent = j.status === 'downloading' ? [fmtSpeed(p.speed), fmtEta(p.eta)].filter(Boolean).join(' · ') : '';
    const msg = e.querySelector('.msg'); msg.className = 'msg' + (j.error ? ' err' : j.note ? ' note' : '');
    msg.textContent = j.error ? j.error + (j.errorPermanent ? '' : (j.note ? ' — ' + j.note : '')) : j.note || (j.status === 'completed' && j.files && j.files[0] ? '저장됨: ' + j.files[0] : '');
    const sig = j.status; const acts = e.querySelector('.acts');
    if (n.sig !== sig) { acts.replaceChildren(...jobActions(j)); n.sig = sig; }
    return e;
  }
  function renderJobs(changed) {
    const box = $('#jobs');
    for (const j of changed || state.jobs.values()) { state.jobs.set(j.id, j); renderJob(j); }
    // 최신 작업이 위로 오도록 정렬(이미 맞으면 건드리지 않는다)
    const order = [...state.jobs.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    let i = 0; for (const j of order) { const el = nodes.get(j.id).el; if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); i++; }
    for (const [id, n] of nodes) if (!state.jobs.has(id)) { n.el.remove(); nodes.delete(id); }
    const mp3Count = [...state.jobs.values()].filter(isMp3Job).length;
    $('#emptyJobs').hidden = state.mode === 'mp3' ? true : state.jobs.size > 0;
    $('#emptyMp3').hidden = !(state.mode === 'mp3' && mp3Count === 0);
    const active = [...state.jobs.values()].filter(j => ['queued', 'downloading', 'processing'].includes(j.status)).length;
    const b = $('#badgeActive'); b.hidden = !active; b.textContent = active;
  }

  // ---------- 구독 ----------
  function renderSubs() {
    const box = $('#subList'); box.replaceChildren();
    for (const s of state.subs) {
      const en = h('input', { type: 'checkbox', checked: s.enabled, 'data-act': 'sub-enable' }); en.addEventListener('change', () => gsd.subs.enable(s.id, en.checked));
      const pend = s.pending || [];
      const pendBox = pend.length ? h('div', { class: 'pending', 'data-act': 'sub-pending' },
        h('div', { class: 'hint', text: `새 영상 ${pend.length}개 — 자동으로 받지 않습니다. 받을 영상을 직접 눌러 주세요.` }),
        ...pend.slice(0, 10).map(e => h('div', { class: 'pitem' }, h('span', { class: 't', text: e.title || e.url, title: e.url }), h('span', { class: 'd', text: fmtDur(e.duration) }),
          h('button', { type: 'button', class: 'small', 'data-act': 'sub-get-one', text: '받기', onclick: async () => { const r = await gsd.subs.download(s.id, [e.key]); afterAdd(r, '영상 '); } }))),
        pend.length > 10 ? h('div', { class: 'hint', text: `…외 ${pend.length - 10}개` }) : null,
        h('div', { class: 'acts' },
          h('button', { type: 'button', class: 'small primary', 'data-act': 'sub-get-all', text: `새 영상 ${pend.length}개 모두 받기`, onclick: async () => { const r = await gsd.subs.download(s.id); afterAdd(r, '영상 '); } }),
          h('button', { type: 'button', class: 'small', 'data-act': 'sub-dismiss', text: '알림 지우기(받지 않음)', onclick: () => gsd.subs.dismiss(s.id) }))) : null;
      box.append(h('div', { class: 'sub', 'data-id': s.id },
        h('div', { class: 'row1' }, h('div', { class: 'title', text: s.title, title: s.url }), h('span', { class: 'chip', text: s.enabled ? (pend.length ? `새 영상 ${pend.length}개` : '새 영상 알림 켜짐') : '꺼짐' })),
        h('div', { class: 'meta', text: `${optionSummary(s.options)} · 마지막 확인 ${fmtTime(s.lastCheck)} · 본 영상 ${s.knownCount}개${s.lastError ? ' · 오류: ' + s.lastError : ''}` }),
        pendBox,
        h('div', { class: 'acts' }, h('label', {}, en, ' 새 영상 알림'),
          h('button', { type: 'button', class: 'small', 'data-act': 'sub-check', text: '지금 확인', onclick: async ev => { const btn = ev.currentTarget; btn.disabled = true; const r = await gsd.subs.check(s.id); btn.disabled = false; toast(r.error ? '확인 실패: ' + r.error : r.newCount ? `새 영상 ${r.newCount}개를 찾았어요. 자동으로 받지 않으니 받을 영상을 직접 눌러 주세요.` : '새 영상이 없습니다.', r.error ? 'err' : r.newCount ? 'ok' : 'info'); } }),
          h('button', { type: 'button', class: 'small danger', 'data-act': 'sub-remove', text: '구독 해제', onclick: async () => { if (await confirmBox('구독 해제', `'${s.title}' 구독을 해제할까요?\n이미 받은 영상은 지워지지 않습니다.`, '해제')) gsd.subs.remove(s.id); } }))));
    }
    $('#emptySubs').hidden = state.subs.length > 0;
    const b = $('#badgeSubs'); b.hidden = !state.subs.length; b.textContent = state.subs.length;
  }

  // ---------- 설정 ----------
  function renderSettings() {
    const s = state.settings, root = $('#settingsForm'); root.replaceChildren();
    const defOpts = cloneOpts(s.defaults);
    const saveDef = () => gsd.setSettings({ defaults: defOpts });
    const num = (id, val, min, max, onch) => { const i = h('input', { type: 'number', id, min, max, value: val, style: 'width:90px' }); i.addEventListener('change', () => onch(Math.max(min, Math.min(max, Number(i.value) || min)))); return i; };
    const check = (id, val, onch) => { const i = h('input', { type: 'checkbox', id, checked: val }); i.addEventListener('change', () => onch(i.checked)); return i; };
    const dirPath = h('span', { class: 'path', id: 'set-savedir', text: s.saveDir, title: s.saveDir });
    const interval = h('select', { id: 'set-interval' }, ...[[15, '15분'], [30, '30분'], [60, '1시간'], [180, '3시간'], [360, '6시간'], [720, '12시간'], [1440, '하루']].map(([v, l]) => h('option', { value: v, text: l, selected: v === s.subscriptionIntervalMin })));
    interval.addEventListener('change', () => gsd.setSettings({ subscriptionIntervalMin: Number(interval.value) }));
    const engVer = h('span', { id: 'engVer', text: '확인 중…' }), appVer = h('span', { id: 'appVer', text: '' });
    root.append(
      h('div', { class: 'card' }, h('h3', { text: '저장과 동시 다운로드' }),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: '저장 폴더' }), dirPath, h('button', { type: 'button', class: 'small', id: 'btnSetDir', text: '변경', onclick: async () => { const p = await gsd.pickFolder(); if (p) { await gsd.setSettings({ saveDir: p }); } } })),
        h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'set-conc', text: '동시 다운로드 수' }), num('set-conc', s.maxConcurrent, 1, 6, v => gsd.setSettings({ maxConcurrent: v })), h('span', { class: 'hint', text: '1~6개. 늘리면 빠르지만 사이트가 일시적으로 막을 수 있어요.' })),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: '자동 다운로드' }), h('span', { class: 'hint', text: '없음 — 직접 링크를 붙여넣고 [다운로드]/[MP3 받기]를 누른 것만 내려받습니다. 클립보드는 [붙여넣기]를 눌렀을 때만 읽고, 구독은 새 영상을 알리기만 합니다.' }))),
      h('div', { class: 'card' }, h('h3', { text: '다운로드 기본값' }),
        h('p', { class: 'hint', text: '[다운로드]를 누르면 이 설정으로 바로 받습니다. 종류·화질은 위 입력창 옆의 형식·화질과 같은 값이고, 자막·MKV·M4A 같은 세부 옵션은 여기서 정합니다. 구독한 목록의 새 영상을 받을 때는 구독할 때의 설정을 씁니다.' }),
        buildOptionsForm(defOpts, { idp: 'def', onChange: saveDef }),
        h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'set-subfolder', text: '재생목록 정리' }), check('set-subfolder', s.playlistSubfolder, v => gsd.setSettings({ playlistSubfolder: v })), h('span', { text: '하위 폴더 만들기', class: 'hint' }), check('set-prefix', s.playlistNumberPrefix, v => gsd.setSettings({ playlistNumberPrefix: v })), h('span', { text: '번호 붙이기', class: 'hint' }))),
      h('div', { class: 'card' }, h('h3', { text: '구독' }), h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'set-interval', text: '새 영상 확인 주기' }), interval, h('span', { class: 'hint', text: '앱이 켜져 있는 동안 이 간격으로 확인합니다.' }))),
      h('div', { class: 'card' }, h('h3', { text: '엔진과 업데이트' }),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'yt-dlp 엔진' }), engVer, h('button', { type: 'button', class: 'small', id: 'btnEngineCheck', text: '엔진 업데이트 확인', onclick: async ev => { const btn = ev.currentTarget; btn.disabled = true; try { await gsd.engine.checkAndOffer(); } finally { btn.disabled = false; refreshVersions(); } } }), check('set-engauto', s.engineAutoCheck, v => gsd.setSettings({ engineAutoCheck: v })), h('span', { class: 'hint', text: '시작할 때 새 엔진이 있는지 확인(받기 전에 항상 물어봅니다)' })),
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'goodseedown' }), appVer, h('button', { type: 'button', class: 'small', id: 'btnAppCheck', text: '앱 업데이트 확인', onclick: () => gsd.checkAppUpdate() }))),
      h('div', { class: 'card' }, h('h3', { text: '안내' }), h('div', { class: 'field' }, h('button', { type: 'button', class: 'small', id: 'btnNotice2', text: '저작권 안내', onclick: () => gsd.showNotice() }), h('button', { type: 'button', class: 'small', id: 'btnLicenses', text: '오픈소스 라이선스', onclick: () => gsd.showLicenses() }), h('button', { type: 'button', class: 'small', id: 'btnAbout2', text: 'goodseedown 정보', onclick: () => openAbout() }))));
    refreshVersions();
    async function refreshVersions() { try { const i = await gsd.appInfo(); engVer.textContent = (i.ytdlpVersion || '알 수 없음') + (i.engineInfo.usingBundled ? ' (설치본)' : ' (업데이트됨)'); appVer.textContent = '버전 ' + i.version; } catch { } }
  }

  // ---------- 탭·초기화 ----------
  function setTab(t) {
    if (state.mode === 'mp3' && t === 'subs') t = 'downloads';
    state.tab = t;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $('#paneDownloads').hidden = t !== 'downloads'; $('#paneSubs').hidden = t !== 'subs'; $('#paneSettings').hidden = t !== 'settings';
    if (t === 'settings') renderSettings();
  }
  // ---------- MP3 화면 ----------
  function applyMode(mode, { persist = false } = {}) {
    state.mode = mode === 'mp3' ? 'mp3' : 'video';
    document.body.dataset.mode = state.mode;
    for (const b of document.querySelectorAll('.mode')) { const on = b.dataset.mode === state.mode; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    $('#mp3Card').hidden = state.mode !== 'mp3';
    if (state.mode === 'mp3' && state.tab === 'subs') setTab('downloads');
    renderJobs([]);
    if (persist) gsd.setSettings({ lastMode: state.mode });
  }
  function applyMp3Controls() {
    const m = state.settings.mp3;
    for (const r of document.querySelectorAll('input[name=mp3q]')) r.checked = Number(r.value) === m.bitrate;
    $('#mp3Id3').checked = !!m.id3; $('#mp3Dir').textContent = m.saveDir; $('#mp3Dir').title = m.saveDir;
  }
  function mp3Options() {
    const m = state.settings.mp3;
    return { kind: 'audio', audioFormat: 'mp3', mp3Bitrate: m.bitrate, id3: m.id3, subs: { enabled: false, langs: [], auto: false, mode: 'srt' } };
  }
  const mp3Profile = () => { const m = state.settings.mp3; return { options: mp3Options(), saveDir: m.saveDir, subfolder: true, indexPrefix: true, label: 'MP3 ', what: `MP3 ${m.bitrate} kbps` }; };
  async function init() {
    state.settings = await gsd.getSettings();
    for (const j of await gsd.listJobs()) state.jobs.set(j.id, j);
    state.subs = await gsd.subs.list();
    applyInline(); renderJobs(); renderSubs(); applyMp3Controls(); applyMode(state.settings.lastMode);
    $('#urlForm').addEventListener('submit', e => { e.preventDefault(); if (!$('#busy').hidden) return; inlineSaving.then(() => submitLinks($('#url'), videoProfile())).catch(err => toast('오류: ' + err.message, 'err')); });
    $('#btnSubscribe').addEventListener('click', () => { if ($('#busy').hidden) subscribeLink().catch(err => toast('오류: ' + err.message, 'err')); });
    $('#btnBusyCancel').addEventListener('click', () => { if (busyCancel) busyCancel(); });
    $('#dlKind').addEventListener('change', e => { const v = e.target.value; if (v === 'video') saveInline({ kind: 'video' }); else if (v === 'mp3') saveInline({ kind: 'audio', audioFormat: 'mp3' }); });
    $('#dlQuality').addEventListener('change', e => { const k = inlineKind(state.settings.defaults); if (k === 'video') saveInline({ quality: e.target.value }); else if (k === 'mp3') saveInline({ mp3Bitrate: Number(e.target.value) }); });
    $('#btnPaste').addEventListener('click', async () => { const u = await gsd.readClipboard(); if (u.length) $('#url').value = u[0]; else toast('클립보드에 링크가 없습니다.', 'info'); $('#url').focus(); });
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => { if (b.dataset.mode !== state.mode) applyMode(b.dataset.mode, { persist: true }); if (state.tab !== 'downloads') setTab('downloads'); (state.mode === 'mp3' ? $('#mp3Url') : $('#url')).focus(); }));
    $('#mp3Form').addEventListener('submit', e => { e.preventDefault(); (!$('#busy').hidden ? Promise.resolve() : submitLinks($('#mp3Url'), mp3Profile())).catch(err => toast('오류: ' + err.message, 'err')); });
    $('#mp3Paste').addEventListener('click', async () => { const u = await gsd.readClipboard(); if (u.length) { $('#mp3Url').value = u[0]; } else toast('클립보드에 링크가 없습니다.', 'info'); $('#mp3Url').focus(); });
    for (const r of document.querySelectorAll('input[name=mp3q]')) r.addEventListener('change', () => { if (r.checked) gsd.setSettings({ mp3: { bitrate: Number(r.value) } }); });
    $('#mp3Id3').addEventListener('change', e => gsd.setSettings({ mp3: { id3: e.target.checked } }));
    $('#mp3PickDir').addEventListener('click', async () => { const p = await gsd.pickFolder(); if (p) await gsd.setSettings({ mp3: { saveDir: p } }); });
    $('#btnPauseAll').addEventListener('click', () => gsd.jobsAll('pause'));
    $('#btnResumeAll').addEventListener('click', () => gsd.jobsAll('resume'));
    $('#btnClear').addEventListener('click', () => gsd.jobsAll('clear'));
    $('#btnOpenDir').addEventListener('click', () => gsd.openSaveDir());
    $('#btnNotice').addEventListener('click', () => gsd.showNotice());
    $('#btnAbout').addEventListener('click', () => openAbout());
    gsd.onShowAbout(() => openAbout());
    gsd.onJobs(arr => renderJobs(arr));
    gsd.onJobsRemoved(id => { state.jobs.delete(id); renderJobs([]); });
    gsd.onSubs(arr => { state.subs = arr; renderSubs(); });
    gsd.onSettings(s => { state.settings = s; applyInline(); applyMp3Controls(); if (state.tab === 'settings') { const a = document.activeElement; if (!a || !$('#settingsForm').contains(a) || a.id === 'set-savedir') renderSettings(); else { const d = $('#set-savedir'); if (d) { d.textContent = s.saveDir; d.title = s.saveDir; } } } });
    // ---------- 새 버전 배너 — 시작 시 자동 확인 결과를 화면 맨 위에 알린다(자동 설치 없음: [업그레이드]를 눌러야 시작) ----------
    let updDismissed = false; // [나중에]: 이번 실행 동안만 숨김(다음 실행에는 다시 보임)
    const showUpd = info => {
      if (!info || !info.version || updDismissed) return;
      $('#updText').replaceChildren(`새 버전(${info.version})이 나왔습니다. 업그레이드하세요.`, h('small', { text: `현재 ${info.current} → ${info.version}${info.sizeLine ? ' · ' + info.sizeLine : ''}` }));
      $('#updBanner').hidden = false;
    };
    $('#btnUpdLater').addEventListener('click', () => { updDismissed = true; $('#updBanner').hidden = true; });
    $('#btnUpgrade').addEventListener('click', async () => {
      const b = $('#btnUpgrade'); b.disabled = true;
      try { const r = await gsd.appUpdateStart(); if (r && r.busy) toast('이미 업데이트를 확인하거나 진행하는 중입니다.', 'info'); }
      catch (err) { toast('업데이트를 시작하지 못했습니다: ' + err.message, 'err'); }
      finally { b.disabled = false; }
    });
    gsd.onAppUpdate(showUpd);
    gsd.appUpdateInfo().then(showUpd).catch(() => { }); // 화면이 늦게 뜬 경우를 위해 이미 확인된 결과도 한 번 읽는다
    gsd.onToast(t => toast(t.text, t.kind));
    gsd.onEngineProgress(p => { if (p.phase === 'start') toast(`yt-dlp 엔진 ${p.version} 을(를) 내려받는 중…`, 'info', 3000); if (p.phase === 'done') refreshEngineLabel(); });
    function refreshEngineLabel() { if (state.tab === 'settings') renderSettings(); }
    if (!state.settings.copyrightAcknowledged) showFirstRun();
    (state.mode === 'mp3' ? $('#mp3Url') : $('#url')).focus();
  }

  // 정보창 — 저작자 표기. '오경근 박사' 링크는 앱 안에서 이동하지 않고 메인 프로세스가 기본 브라우저로 연다(shell.openExternal).
  const AUTHOR_URL = 'https://ohkyoungkeun-namecard.vercel.app/';
  async function openAbout() {
    let info = {}; try { info = await gsd.appInfo(); } catch { }
    const link = h('a', { href: AUTHOR_URL, id: 'aboutAuthor', class: 'link', title: AUTHOR_URL + ' (기본 브라우저로 열림)', text: '오경근 박사' });
    link.addEventListener('click', async e => { e.preventDefault(); const r = await gsd.openAuthor(); if (!r || !r.ok) toast('브라우저를 열지 못했습니다. 주소: ' + AUTHOR_URL, 'err', 7000); });
    openModal(close => h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'goodseedown 정보', id: 'dlgAbout', style: 'width:min(560px,100%)' },
      h('header', {}, h('img', { src: 'icon.png', alt: '', style: 'width:54px;height:54px;object-fit:contain' }), h('div', { class: 't' }, h('b', { text: 'goodseedown ' + (info.version || '') }), h('small', { text: 'Windows x64 동영상·MP3 다운로더' }))),
      h('div', { class: 'body' },
        h('p', { id: 'aboutCredit' }, '굿씨드AI연구소(goodseed AI LAB) ', link),
        h('p', { class: 'hint', id: 'aboutCopyright', text: 'Copyright (c) 2026 굿씨드AI연구소 오경근 박사' }),
        h('p', { class: 'hint', text: '다운로드 엔진: yt-dlp (Unlicense) · 변환: ffmpeg (GPLv3) — 자세한 내용은 [오픈소스 라이선스]' }),
        h('p', { class: 'hint', text: '저작권이 있는 콘텐츠는 권리자의 허락을 받았거나 개인적으로 이용할 수 있는 범위에서만 내려받으세요. DRM(복제 방지) 보호 콘텐츠는 지원하지 않습니다.' }),
        info.dataDir ? h('p', { class: 'hint', text: '데이터 폴더: ' + info.dataDir }) : null),
      h('footer', {}, h('button', { type: 'button', text: '오픈소스 라이선스', onclick: () => gsd.showLicenses() }), h('button', { type: 'button', text: '업데이트 확인', onclick: () => { close(); gsd.checkAppUpdate(); } }), h('button', { type: 'button', class: 'primary', id: 'btnAboutClose', 'data-autofocus': '1', text: '닫기', onclick: close }))));
  }

  function showFirstRun() {
    openModal(close => {
      const d = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': '저작권 안내', id: 'dlgFirstRun', 'data-nocancel': '1', style: 'width:min(600px,100%)' },
        h('header', {}, h('img', { src: 'icon.png', alt: '', style: 'width:54px;height:54px;object-fit:contain' }), h('div', { class: 't' }, h('b', { text: 'goodseedown 을 시작하기 전에' }), h('small', { text: '저작권 안내' }))),
        h('div', { class: 'body' },
          h('p', { text: '저작권이 있는 콘텐츠는 권리자의 허락을 받았거나 개인적으로 이용할 수 있는 범위에서만 내려받으세요.' }),
          h('p', { text: 'DRM(복제 방지)으로 보호된 콘텐츠를 우회하는 기능은 없으며, 앞으로도 넣지 않습니다.' }),
          h('p', { class: 'hint', text: '내려받은 영상을 다시 올리거나 배포하는 것은 각 사이트의 약관과 저작권법에 따라 제한될 수 있습니다. 이용에 대한 책임은 사용자에게 있습니다.' })),
        h('footer', {}, h('button', { type: 'button', class: 'primary', id: 'btnAck', 'data-autofocus': '1', text: '확인하고 시작', onclick: async () => { state.settings = await gsd.setSettings({ copyrightAcknowledged: true }); close(); } })));
      return d;
    });
  }

  init().catch(e => { document.body.prepend(h('pre', { text: '시작 오류: ' + e.message, style: 'color:#f88;padding:20px' })); });
})();
