/* KumbhConnect — "Report content" (Google Play UGC policy).
   Any piece of user-generated or AI-generated content can be reported with one tap.
   Usage (declarative):  <button class="kc-report-btn" data-kc-report-type="photo" data-kc-report-id="DOC_ID">…</button>
   Usage (code):         KCReport.open({ type:'photo', id:'DOC_ID', text:'optional excerpt' })
   Reports are written to Firestore `kc_reports` (see FIRESTORE-RULES-ADDITIONS.md). If that write is
   refused or offline, the report falls back to a pre-filled e-mail to the team. */
(function () {
  'use strict';
  var MAIL = 'kumbhmelaconnect@gmail.com';
  var COL = 'kc_reports';
  var S = {
    mr: { title: 'आक्षेपार्ह मजकूर कळवा', why: 'कारण निवडा', note: 'अधिक माहिती (ऐच्छिक)', send: 'पाठवा', cancel: 'रद्द करा',
      ok: 'धन्यवाद! तुमची तक्रार आमच्या टीमकडे पाठवली आहे.', mail: 'तक्रार ई-मेलद्वारे पाठवण्यासाठी ई-मेल अ‍ॅप उघडत आहे.', btn: 'कळवा',
      r: { offensive: 'अश्लील / आक्षेपार्ह', hate: 'द्वेष / धमकी / छळ', spam: 'स्पॅम / फसवणूक', false_info: 'चुकीची किंवा दिशाभूल करणारी माहिती', privacy: 'खाजगी माहिती / कॉपीराइट', unsafe: 'धोकादायक / असुरक्षित', other: 'इतर' } },
    hi: { title: 'आपत्तिजनक सामग्री रिपोर्ट करें', why: 'कारण चुनें', note: 'अधिक जानकारी (वैकल्पिक)', send: 'भेजें', cancel: 'रद्द करें',
      ok: 'धन्यवाद! आपकी रिपोर्ट हमारी टीम को भेज दी गई है।', mail: 'रिपोर्ट ई-मेल से भेजने के लिए ई-मेल ऐप खुल रहा है।', btn: 'रिपोर्ट',
      r: { offensive: 'अश्लील / आपत्तिजनक', hate: 'नफ़रत / धमकी / उत्पीड़न', spam: 'स्पैम / धोखाधड़ी', false_info: 'गलत या भ्रामक जानकारी', privacy: 'निजी जानकारी / कॉपीराइट', unsafe: 'खतरनाक / असुरक्षित', other: 'अन्य' } },
    en: { title: 'Report content', why: 'Select a reason', note: 'More details (optional)', send: 'Submit', cancel: 'Cancel',
      ok: 'Thank you! Your report has been sent to our team.', mail: 'Opening your e-mail app to send the report.', btn: 'Report',
      r: { offensive: 'Sexual / offensive', hate: 'Hate / threats / harassment', spam: 'Spam / scam', false_info: 'False or misleading information', privacy: 'Private information / copyright', unsafe: 'Dangerous / unsafe', other: 'Other' } }
  };
  function lang() { var l = 'mr'; try { l = localStorage.getItem('kc_lang') || window._lang || 'mr'; } catch (e) { l = window._lang || 'mr'; } return S[l] ? l : 'mr'; }
  function T() { return S[lang()]; }

  function css() {
    if (document.getElementById('kc-report-css')) return;
    var st = document.createElement('style'); st.id = 'kc-report-css';
    st.textContent =
      '.kc-report-btn{display:inline-flex;align-items:center;gap:4px;min-height:36px;padding:0 10px;margin:4px 0 0;border:1px solid #F0D5B8;border-radius:18px;background:#fff;color:#7B1616;font:600 .72rem/1 inherit;font-family:inherit;cursor:pointer}' +
      '.kc-report-btn:active{transform:scale(.97)}' +
      '.ai-msg-bot-row .kc-report-btn{flex:0 0 auto;align-self:center;margin:0 0 0 4px;min-width:36px;padding:0 8px}' +
      '#kc-report-ov{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:none;align-items:flex-end;justify-content:center}' +
      '#kc-report-ov.open{display:flex}' +
      '#kc-report-sheet{width:100%;max-width:520px;max-height:90vh;max-height:90dvh;overflow-y:auto;overscroll-behavior:contain;background:#fff;color:#1A0800;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));font-family:Mukta,Khand,sans-serif}' +
      '#kc-report-sheet h3{font-size:1.1rem;color:#C8410A;margin:0 0 10px}' +
      '#kc-report-sheet label{display:block;font-size:.8rem;font-weight:600;margin:10px 0 4px}' +
      '#kc-report-sheet select,#kc-report-sheet textarea{width:100%;font:inherit;font-size:.9rem;padding:10px;border:1.5px solid #F0D5B8;border-radius:10px;background:#FFFAF4;color:#1A0800}' +
      '#kc-report-sheet textarea{min-height:80px;resize:vertical}' +
      '#kc-report-sheet .kcr-row{display:flex;gap:8px;margin-top:14px}' +
      '#kc-report-sheet .kcr-row button{flex:1;min-height:44px;border-radius:12px;font:700 .9rem inherit;font-family:inherit;cursor:pointer;border:1.5px solid #C8410A}' +
      '#kc-report-send{background:#C8410A;color:#fff}#kc-report-cancel{background:#fff;color:#C8410A}' +
      '#kc-report-send[disabled]{opacity:.6}';
    document.head.appendChild(st);
  }

  var ctx = null;
  function build() {
    if (document.getElementById('kc-report-ov')) return;
    css();
    var ov = document.createElement('div'); ov.id = 'kc-report-ov';
    ov.innerHTML = '<div id="kc-report-sheet" role="dialog" aria-modal="true" aria-labelledby="kc-report-h"><h3 id="kc-report-h"></h3>' +
      '<label for="kc-report-why"></label><select id="kc-report-why"></select>' +
      '<label for="kc-report-note"></label><textarea id="kc-report-note" maxlength="300"></textarea>' +
      '<div class="kcr-row"><button type="button" id="kc-report-cancel"></button><button type="button" id="kc-report-send"></button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('kc-report-cancel').addEventListener('click', close);
    document.getElementById('kc-report-send').addEventListener('click', submit);
  }
  function lock(on) {
    try { if (typeof window.kcScrollLock === 'function') { on ? window.kcScrollLock('kc-report') : window.kcScrollUnlock('kc-report'); return; } } catch (e) {}
    document.body.style.overflow = on ? 'hidden' : '';
  }
  function say(msg) { try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {} try { alert(msg); } catch (e) {} }
  function close() { var ov = document.getElementById('kc-report-ov'); if (ov) ov.classList.remove('open'); lock(false); ctx = null; }

  function open(c) {
    ctx = { type: String((c && c.type) || 'content').slice(0, 30), id: String((c && c.id) || '').slice(0, 120), text: String((c && c.text) || '').slice(0, 500) };
    build();
    var t = T();
    document.getElementById('kc-report-h').textContent = t.title;
    var labs = document.querySelectorAll('#kc-report-sheet label');
    labs[0].textContent = t.why; labs[1].textContent = t.note;
    var sel = document.getElementById('kc-report-why'); sel.innerHTML = '';
    Object.keys(t.r).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = t.r[k]; sel.appendChild(o); });
    document.getElementById('kc-report-note').value = '';
    document.getElementById('kc-report-cancel').textContent = t.cancel;
    var sb = document.getElementById('kc-report-send'); sb.textContent = t.send; sb.disabled = false;
    document.getElementById('kc-report-ov').classList.add('open');
    lock(true);
  }

  function mailFallback(rep) {
    var body = 'Type: ' + rep.type + '\nID: ' + rep.targetId + '\nReason: ' + rep.reason + '\nNote: ' + rep.note + '\nExcerpt: ' + rep.excerpt + '\nPage: ' + rep.page;
    say(T().mail);
    window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Content report — ' + rep.type) + '&body=' + encodeURIComponent(body);
  }

  async function submit() {
    if (!ctx) return;
    var sb = document.getElementById('kc-report-send'); sb.disabled = true;
    var uid = null;
    try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; uid = u ? u.uid : null; } catch (e) {}
    var rep = { type: ctx.type, targetId: ctx.id, excerpt: ctx.text, reason: document.getElementById('kc-report-why').value,
      note: document.getElementById('kc-report-note').value.trim().slice(0, 300), page: (location.pathname.split('/').pop() || 'index.html').slice(0, 60) };
    try {
      if (typeof db === 'undefined' || !window.firebase) throw new Error('no-db');
      var doc = { type: rep.type, targetId: rep.targetId, excerpt: rep.excerpt, reason: rep.reason, note: rep.note, page: rep.page,
        reporterUid: uid, lang: lang(), status: 'open', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await Promise.race([db.collection(COL).add(doc), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 8000); })]);
      close(); say(T().ok);
    } catch (e) {
      close(); mailFallback(rep);
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.kc-report-btn');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var text = b.getAttribute('data-kc-report-text') || '';
    if (b.getAttribute('data-kc-report-from') === 'ai') {
      var row = b.closest('.ai-msg-bot-row'); var m = row && row.querySelector('.ai-msg-bot'); text = m ? m.textContent : '';
    }
    open({ type: b.getAttribute('data-kc-report-type'), id: b.getAttribute('data-kc-report-id'), text: text });
  }, true);

  window.KCReport = {
    open: open,
    button: function (type, id, text) {
      css(); var b = document.createElement('button'); b.type = 'button'; b.className = 'kc-report-btn';
      b.setAttribute('data-kc-report-type', type); b.setAttribute('data-kc-report-id', id || ''); if (text) b.setAttribute('data-kc-report-text', text);
      b.setAttribute('aria-label', T().btn); b.textContent = '⚑ ' + T().btn; return b;
    }
  };
})();
