(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nav = q('#site-nav');
  const navToggle = q('.nav-toggle');
  q('#year').textContent = new Date().getFullYear();

  const paymentDialog = q('#payment-dialog');
  if (paymentDialog) {
    const planSelect = q('#payment-plan');
    const updatePaymentPreview = () => {
      const option = planSelect.selectedOptions[0];
      const amount = option.dataset.amount;
      q('#payment-plan-summary').textContent = `Selected: ${option.textContent}. This is a proposed package, not an invoice.`;
      q('#payment-inr-summary').textContent = amount ? `Proposed amount: ₹${Number(amount).toLocaleString('en-IN')} per month. This is not payable through the demo.` : 'A written custom quote is required before any invoice or payment can exist.';
    };
    q('#review-payment').addEventListener('click', () => { updatePaymentPreview(); paymentDialog.showModal(); });
    q('#payment-close').addEventListener('click', () => paymentDialog.close());
    q('#payment-contact-link').addEventListener('click', () => paymentDialog.close());
    planSelect.addEventListener('change', updatePaymentPreview);
  }

  navToggle.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') !== 'true';
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    nav.classList.toggle('is-open', open);
  });
  qa('#site-nav a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open navigation');
  }));

  qa('[data-dialog]').forEach(button => button.addEventListener('click', () => {
    const dialog = q(`#${button.dataset.dialog}`);
    if (dialog?.showModal) dialog.showModal();
  }));
  qa('.info-dialog').forEach(dialog => {
    q('.dialog-close', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  });

  const log = q('#chat-log');
  const options = q('#chat-options');
  const chatForm = q('#chat-form');
  const chatInput = q('#chat-input');
  const api = async (path, body) => { const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result; };
  api('/api/status').then(status => { const label = q('.chat-agent small'); if (label) label.textContent = status.mode === 'demo' ? 'DEMO MODE · fictional sample data' : 'AI adapter configured · provider unverified'; }).catch(() => {});
  let stage = 'intent';
  let enquiry = {};

  function say(text, speaker = 'assistant', style = '') {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${speaker}${style ? ` ${style}` : ''}`;
    bubble.textContent = text;
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
  }

  function showChoices(labels) {
    options.replaceChildren();
    labels.forEach(label => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-choice';
      button.textContent = label;
      button.addEventListener('click', () => accept(label));
      options.append(button);
    });
  }

  function begin() {
    enquiry = {};
    stage = 'intent';
    log.replaceChildren();
    options.replaceChildren();
    chatInput.value = '';
    say('Hello. Are you looking to buy, rent or sell a property?');
    showChoices(['Buy', 'Rent', 'Sell', 'Ask a question']);
  }

  function moveToNext(answer) {
    if (stage === 'intent') {
      const kind = answer.toLowerCase();
      if (kind.includes('question')) {
        stage = 'faq';
        say('Sure. Ask about our process, service areas, fees or arranging a conversation with a person. This demo has no live property listings.');
        showChoices(['Service areas', 'Fees', 'How does it work?', 'Property availability']);
        return;
      }
      enquiry.intent = kind === 'buy' ? 'buyer' : kind;
      stage = 'location';
      say(kind === 'sell' ? 'Which area is the property in?' : 'Which location or neighbourhood do you prefer?');
      return;
    }
    if (stage === 'location') {
      enquiry.location = answer;
      stage = 'budget';
      say(enquiry.intent === 'sell' ? 'What price range do you have in mind? This is only a request; the team would confirm any valuation.' : 'What budget range should I note?');
      return;
    }
    if (stage === 'budget') {
      enquiry.budget = answer;
      stage = 'property';
      say('What type of property are you interested in?');
      showChoices(['Apartment', 'Villa / row house', 'Plot / land', 'Commercial', 'Other']);
      return;
    }
    if (stage === 'property') {
      enquiry.propertyType = answer;
      stage = 'timeline';
      say('When are you hoping to move, buy or complete the sale?');
      showChoices(['As soon as possible', 'Within 1–3 months', 'In 3–6 months', 'Just exploring']);
      return;
    }
    if (stage === 'timeline') {
      enquiry.timeline = answer;
      stage = 'share';
      say('Would you like to leave contact details for a human follow-up? Nothing is saved unless you choose to share and give consent.');
      showChoices(['Share details with consent', 'Continue without sharing', 'Ask a question']);
      return;
    }
    if (stage === 'faq') {
      api('/api/chat', { message: answer, context: enquiry }).then(result => { say(result.text, 'assistant', result.handoff ? 'notice' : ''); if (result.handoff) api('/api/handoffs', { question: answer, intent: enquiry.intent || 'question', summary: summary() }).catch(() => say('The local handoff queue could not be reached.', 'assistant', 'notice')); }).catch(() => say('The local answer service could not be reached.', 'assistant', 'notice'));
      showChoices(['Request a human follow-up', 'Start over']);
      stage = 'handoff';
      return;
    }
    if (stage === 'handoff') {
      if (answer.toLowerCase().includes('start')) { begin(); return; }
      if (answer.toLowerCase().includes('request')) api('/api/handoffs', { question: 'Visitor requested human follow-up.', intent: enquiry.intent || 'question', summary: summary() }).then(() => say('Request saved in the local queue. No one has been contacted.')).catch(() => say('The follow-up request could not be saved.'));
      enquiry.intent ||= 'question';
      stage = 'share';
      say('I can take a contact detail for the team, only if you consent.');
      showChoices(['Share details with consent', 'Continue without sharing']);
      return;
    }
    if (stage === 'share') {
      const text = answer.toLowerCase();
      if (text.includes('ask')) { stage = 'faq'; say('What would you like to know?'); showChoices(['Service areas', 'Fees', 'Property availability']); return; }
      if (text.includes('without')) {
        say('Understood. I have not collected or saved contact details. Your sample enquiry summary: ' + summary());
        say('A real team member would need to confirm any property details or appointment. This demo does not submit the enquiry.');
        stage = 'complete'; options.replaceChildren(); return;
      }
      stage = 'contact';
      showContactFields();
    }
  }

  function summary() {
    const parts = [enquiry.intent, enquiry.location, enquiry.budget, enquiry.propertyType, enquiry.timeline].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'question for a human follow-up';
  }

  function showContactFields() {
    options.replaceChildren();
    const fields = document.createElement('div');
    fields.className = 'chat-contact-fields';
    fields.innerHTML = '<label class="chat-consent"><input id="chat-consent" type="checkbox"><span>I consent to save these details on this computer for the fictional demo agency to review locally. No one will contact me. Contact fields appear after consent.</span></label><div id="chat-contact-fields" hidden><label class="sr-only" for="chat-name">Your name, optional</label><input id="chat-name" autocomplete="name" placeholder="Your name (optional)" disabled><label class="sr-only" for="chat-contact">Phone or email</label><input id="chat-contact" type="text" inputmode="email" autocomplete="email" placeholder="Phone number or email" required disabled><button type="button" class="chat-choice" id="save-enquiry" disabled>Save demo enquiry</button></div><p class="form-message" id="chat-feedback" role="status"></p>';
    options.append(fields);
    q('#chat-consent').addEventListener('change', event => {
      const allowed = event.currentTarget.checked;
      const contactFields = q('#chat-contact-fields');
      contactFields.hidden = !allowed;
      q('#chat-name').disabled = !allowed;
      q('#chat-contact').disabled = !allowed;
      q('#save-enquiry').disabled = !allowed;
      if (allowed) q('#chat-contact').focus();
    });
    q('#save-enquiry').addEventListener('click', saveEnquiry);
  }

  function saveEnquiry() {
    const consent = q('#chat-consent');
    const contact = q('#chat-contact');
    const feedback = q('#chat-feedback');
    if (!consent.checked) { feedback.textContent = 'Please give consent before sharing contact details.'; feedback.className = 'form-message error'; return; }
    const contactValue = contact.value.trim();
    const normalizedPhone = contactValue.replace(/[\s().-]/g, '');
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactValue);
    const isPhone = /^\+?\d{7,15}$/.test(normalizedPhone);
    if (!isEmail && !isPhone) { feedback.textContent = 'Enter a valid email address or phone number (7–15 digits).'; feedback.className = 'form-message error'; contact.focus(); return; }
    const entry = { ...enquiry, name: q('#chat-name').value.trim(), contact: contact.value.trim(), consent: true, savedAt: new Date().toISOString() };
    api('/api/leads', { ...entry, ...enquiry }).then(() => { say('Thank you. Your consented enquiry was saved locally for the admin view. No one has been contacted.'); say('Demo enquiry · ' + summary()); options.replaceChildren(); stage = 'complete'; }).catch(error => { feedback.textContent = error.message; feedback.className = 'form-message error'; });
  }

  function accept(label) {
    say(label, 'visitor');
    options.replaceChildren();
    moveToNext(label);
  }

  chatForm.addEventListener('submit', event => {
    event.preventDefault();
    const value = chatInput.value.trim();
    if (!value) return;
    chatInput.value = '';
    say(value, 'visitor');
    options.replaceChildren();
    if (stage === 'contact') {
      say('Use the contact fields above and give consent before saving. You can also restart without saving anything.');
      return;
    }
    if (stage === 'complete') {
      say('This conversation is complete. You can restart to explore another sample enquiry.');
      return;
    }
    moveToNext(value);
  });
  q('#chat-restart').addEventListener('click', begin);
  begin();

  const contactForm = q('#contact-form');
  const formMessage = q('#form-message');
  const contactConsent = q('#contact-consent');
  contactForm.insertBefore(q('.form-consent', contactForm), q('.form-row', contactForm));
  const setContactFields = allowed => { contactForm.classList.toggle('consent-granted', allowed); qa('.form-row', contactForm).forEach(row => { row.hidden = !allowed; row.style.display = allowed ? '' : 'none'; qa('input, select', row).forEach(field => { field.disabled = !allowed; }); }); };
  setContactFields(false);
  contactConsent.addEventListener('change', () => { setContactFields(contactConsent.checked); if (contactConsent.checked) q('#contact-name').focus(); });
  contactForm.addEventListener('submit', event => {
    event.preventDefault();
    formMessage.className = 'form-message';
    if (!contactConsent.checked) { formMessage.textContent = 'Please consent before the contact fields are shown or details are collected.'; formMessage.classList.add('error'); contactConsent.focus(); return; }
    const name = q('#contact-name').value.trim();
    const email = q('#contact-email').value.trim();
    const need = q('#contact-need').value;
    if (name.length < 2) { formMessage.textContent = 'Please enter a name with at least two characters.'; formMessage.classList.add('error'); q('#contact-name').focus(); return; }
    if (!q('#contact-email').checkValidity() || !email) { formMessage.textContent = 'Please enter a valid email address.'; formMessage.classList.add('error'); q('#contact-email').focus(); return; }
    if (!need) { formMessage.textContent = 'Please choose a topic to explore.'; formMessage.classList.add('error'); q('#contact-need').focus(); return; }
    const request = { name, business: q('#contact-business').value.trim(), email, need, consent: true, createdAt: new Date().toISOString() };
    try {
      api('/api/leads', { intent:'business-demo', ...request, contact:email }).then(() => { formMessage.textContent = 'Consent recorded. Demo request saved to the local admin view only; nothing was sent.'; contactForm.reset(); setContactFields(false); }).catch(error => { formMessage.textContent = error.message; formMessage.classList.add('error'); });
    } catch (_) {
      formMessage.textContent = 'The browser could not store this demo request. Nothing was sent.';
    }
  });

  // Scroll storytelling stays decorative: native scrolling and all content work without it.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealTargets = qa('.section-kicker, .problem-grid, .story-beats p, .problem-list > div, .product-film-heading, .dashboard-window, .feature-card, .step, .solution-grid article, .demo-intro, .chat-window, .price-card, .faq-list details, .contact-content, .final-copy');
    revealTargets.forEach(el => el.setAttribute('data-reveal', ''));
    const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); revealObserver.unobserve(entry.target); }
    }), { threshold: .14, rootMargin: '0px 0px -7% 0px' });
    revealTargets.forEach(el => revealObserver.observe(el));

    const beatObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('is-active');
      else entry.target.classList.remove('is-active');
    }), { threshold: .75 });
    qa('.story-beats p, .steps .step').forEach(el => beatObserver.observe(el));

    let ticking = false;
    const parallax = () => {
      const h = q('.film-scene');
      const section = q('.story-problem');
      const dashboard = q('.dashboard-window');
      const vh = window.innerHeight || 1;
      if (h) h.style.setProperty('--scroll-progress', Math.min(window.scrollY / vh, 1).toFixed(3));
      if (section) {
        const rect = section.getBoundingClientRect();
        section.style.setProperty('--story-scale', (1 + Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height))) * .055).toFixed(3));
      }
      if (dashboard) {
        const rect = dashboard.getBoundingClientRect();
        const progress = Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)));
        dashboard.style.setProperty('--dash-y', `${Math.round(32 - progress * 32)}px`);
        dashboard.style.setProperty('--dash-tilt', `${(3 - progress * 3).toFixed(2)}deg`);
      }
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { window.requestAnimationFrame(parallax); ticking = true; } }, { passive: true });
    parallax();
  }
})();
