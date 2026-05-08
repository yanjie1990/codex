import { buildAnglePrompt } from './camera-prompt.js';

const yearEl = document.getElementById('year');
const headerEl = document.querySelector('.site-header');
const navLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
const navSections = navLinks
  .map((link) => {
    const href = link.getAttribute('href');
    if (!href || href === '#top') {
      return null;
    }

    const target = document.querySelector(href);
    return target ? { link, target } : null;
  })
  .filter(Boolean);
const locale = document.documentElement.lang || 'en';
const toolRoot = document.getElementById('tool');
const googleClientId = document.querySelector('meta[name="google-client-id"]')?.content || '';
// Force the redirect-based Google sign-in flow in all environments.
// This avoids Google GIS origin restrictions during local development and previews.
const useGoogleWidget = false;
let authState = null;
let googleScriptPromise = null;

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function parseApiJson(response, endpoint) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  const contentType = response.headers.get('content-type') || '';
  const looksLikeJson = contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[');
  if (!looksLikeJson) {
    throw new Error(
      locale.startsWith('zh')
        ? `接口 ${endpoint} 返回了非 JSON 内容，请确认后端 API 已启动。`
        : `Endpoint ${endpoint} returned non-JSON content. Make sure the backend API is running.`
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      locale.startsWith('zh')
        ? `接口 ${endpoint} JSON 解析失败，请检查后端返回格式。`
        : `Failed to parse JSON from ${endpoint}. Check backend response format.`
    );
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Clipboard copy failed');
  }
}

async function ensureGoogleScript() {
  if (!useGoogleWidget) {
    return false;
  }

  if (window.google?.accounts?.id) {
    return true;
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Failed to load Google sign-in script'));
      document.head.appendChild(script);
    });
  }

  return googleScriptPromise;
}

function syncHeaderStyle() {
  if (!headerEl) {
    return;
  }

  if (window.scrollY > 8) {
    headerEl.classList.add('scrolled');
  } else {
    headerEl.classList.remove('scrolled');
  }
}

function syncNavState() {
  if (!navSections.length) {
    return;
  }

  const headerOffset = (headerEl?.offsetHeight || 0) + 24;
  const scrollPosition = window.scrollY + headerOffset;
  let activeId = navSections[0].target.id;

  for (const section of navSections) {
    if (section.target.offsetTop <= scrollPosition) {
      activeId = section.target.id;
    } else {
      break;
    }
  }

  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${activeId}`;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function initBeforeAfterSliders() {
  const sliders = Array.from(document.querySelectorAll('[data-ba-slider]'));
  const percentLabel = locale.startsWith('zh') ? '百分比' : 'percent';

  sliders.forEach((slider) => {
    const stage = slider.querySelector('.ba-stage');
    const handle = slider.querySelector('[data-ba-handle]');

    if (!stage || !handle) {
      return;
    }

    slider.classList.add('is-enhanced');

    let value = 50;
    let dragging = false;

    const setValue = (nextValue) => {
      value = clamp(nextValue, 0, 100);
      slider.style.setProperty('--ba-pos', `${value}%`);
      handle.setAttribute('aria-valuenow', String(Math.round(value)));
      handle.setAttribute('aria-valuetext', `${Math.round(value)} ${percentLabel}`);
    };

    const getValueFromClientX = (clientX) => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width) {
        return value;
      }
      return ((clientX - rect.left) / rect.width) * 100;
    };

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }
      setValue(getValueFromClientX(event.clientX));
    };

    const onPointerUp = () => {
      dragging = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    const startDrag = (clientX) => {
      dragging = true;
      setValue(getValueFromClientX(clientX));
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.focus({ preventScroll: true });
      startDrag(event.clientX);
    });

    stage.addEventListener('pointerdown', (event) => {
      startDrag(event.clientX);
    });

    stage.addEventListener(
      'touchstart',
      (event) => {
        const point = event.touches[0];
        if (!point) {
          return;
        }
        setValue(getValueFromClientX(point.clientX));
      },
      { passive: true }
    );

    stage.addEventListener(
      'touchmove',
      (event) => {
        const point = event.touches[0];
        if (!point) {
          return;
        }
        event.preventDefault();
        setValue(getValueFromClientX(point.clientX));
      },
      { passive: false }
    );

    handle.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setValue(value - 2);
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setValue(value + 2);
      }

      if (event.key === 'Home') {
        event.preventDefault();
        setValue(0);
      }

      if (event.key === 'End') {
        event.preventDefault();
        setValue(100);
      }
    });

    window.addEventListener('resize', () => {
      setValue(value);
    });

    setValue(50);
  });
}

function initHeroAngleStage() {
  const stage = document.querySelector('[data-hero-angle-stage]');
  if (!stage) {
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let spread = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;

  const sync = () => {
    stage.style.setProperty('--hero-spread', String(spread));
    stage.style.setProperty('--hero-drift-x', `${((pointerX - 0.5) * 24).toFixed(2)}px`);
    stage.style.setProperty('--hero-drift-y', `${((pointerY - 0.5) * 10).toFixed(2)}px`);
  };

  const setSpread = (nextValue) => {
    spread = clamp(nextValue, 0, 1);
    sync();
  };

  sync();

  if (reducedMotion) {
    setSpread(0.72);
    return;
  }

  stage.addEventListener(
    'pointermove',
    (event) => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }

      pointerX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      pointerY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      sync();
    },
    { passive: true }
  );

  stage.addEventListener(
    'pointerleave',
    () => {
      pointerX = 0.5;
      pointerY = 0.5;
      sync();
    },
    { passive: true }
  );

  stage.addEventListener(
    'wheel',
    (event) => {
      const delta = event.deltaY || event.deltaX || 0;
      const nextSpread = clamp(spread + delta * 0.0014, 0, 1);
      if (nextSpread === spread) {
        return;
      }

      event.preventDefault();
      setSpread(nextSpread);
    },
    { passive: false }
  );

  stage.addEventListener('mouseenter', () => {
    stage.classList.add('is-interactive');
  });

  stage.addEventListener('mouseleave', () => {
    stage.classList.remove('is-interactive');
  });
}

function initRevealAnimations() {
  const nodes = Array.from(document.querySelectorAll('.reveal'));
  if (!nodes.length) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    },
    {
      threshold: 0.16,
      rootMargin: '0px 0px -60px 0px'
    }
  );

  nodes.forEach((node) => observer.observe(node));
}

syncHeaderStyle();
syncNavState();
window.addEventListener('scroll', () => {
  syncHeaderStyle();
  syncNavState();
}, { passive: true });
window.addEventListener('resize', syncNavState, { passive: true });
initBeforeAfterSliders();
initHeroAngleStage();
initRevealAnimations();

function initAuthConsole() {
  const copy = locale.startsWith('zh')
    ? {
        checking: '正在检查状态…',
        signedOut: 'Google 登录后可用 3 次免费额度，订阅入口始终可见。',
        freePlan: (left) => `免费额度 ${left} 次`,
        freeUsed: (used) => `已生成 ${used} 次`,
        activeSub: '订阅有效',
        inactiveSub: '未订阅',
        whitelistActive: '白名单',
        whitelistNoBilling: '白名单账号，无需订阅',
        buyPlan: '订阅',
        managePlan: '管理订阅',
        buying: '正在跳转…',
        managing: '打开订阅页…',
        generateBtn: '生成角度',
        signInToGenerate: '登录后生成',
        subscribeToContinue: '订阅后继续',
        usageSignedOut: '登录后可查看额度和记录。',
        usageEmpty: '暂无生成记录。',
        usageSummary: (count) => `已生成 ${count} 次`,
        usageLast: (date) => `最近 ${date}`,
        signedIn: '已登录',
        login: 'Google 登录',
        logout: '退出',
        admin: '后台',
        authFailed: '状态加载失败',
        planSuffix: '到期',
        subscribePrompt: '可随时订阅',
        freeQuotaUsed: '免费额度已用完',
      }
    : {
        checking: 'Checking status…',
        signedOut: 'Sign in with Google to unlock 3 free generations. Subscribe stays visible.',
        freePlan: (left) => `${left} free generations left`,
        freeUsed: (used) => `${used} generations used`,
        activeSub: 'Subscription active',
        inactiveSub: 'Not subscribed',
        whitelistActive: 'Whitelist',
        whitelistNoBilling: 'Whitelisted account, no billing needed',
        buyPlan: 'Subscribe',
        managePlan: 'Manage billing',
        buying: 'Redirecting…',
        managing: 'Opening billing page…',
        generateBtn: 'Generate angle',
        signInToGenerate: 'Sign in to generate',
        subscribeToContinue: 'Subscribe to continue',
        usageSignedOut: 'Sign in to see quota and usage.',
        usageEmpty: 'No generations yet.',
        usageSummary: (count) => `${count} generations`,
        usageLast: (date) => `Latest ${date}`,
        signedIn: 'Signed in',
        login: 'Sign in with Google',
        logout: 'Log out',
        admin: 'Admin',
        authFailed: 'Failed to load status',
        planSuffix: 'through',
        subscribePrompt: 'Subscribe anytime',
        freeQuotaUsed: 'Free generations used up',
      };

  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const authStatus = document.getElementById('authStatus');
  const authLabel = document.getElementById('authLabel');
  const authMessage = document.getElementById('authMessage');
  const authName = document.getElementById('authName');
  const authEmail = document.getElementById('authEmail');
  const authAvatar = document.getElementById('authAvatar');
  const subscriptionState = document.getElementById('subscriptionState');
  const subscribeBtn = document.getElementById('subscribeBtn');
  const navSubscribeBtn = document.getElementById('navSubscribeBtn');
  const adminBtn = document.getElementById('adminBtn');
  const trialCountState = document.getElementById('trialCountState');
  const whitelistBadge = document.getElementById('whitelistBadge');
  const usageState = document.getElementById('usageState');
  const confirmBtn = document.getElementById('confirm3DBtn');
  const toolStatus = document.getElementById('toolStatus');
  const googleSignInMount = document.getElementById('googleSignInMount');

  if (!loginBtn || !logoutBtn || !subscriptionState) {
    return;
  }

  let googleInitPromise = null;
  let googleRenderRetryTimer = null;
  let billingInProgress = false;
  const billingSearchParams = new URLSearchParams(window.location.search);
  const billingReturnState = {
    success: billingSearchParams.get('billing') === 'success' || billingSearchParams.get('success') === 'true',
    canceled: billingSearchParams.get('billing') === 'canceled' || billingSearchParams.get('canceled') === 'true'
  };
  let billingRefreshTimer = null;
  let billingRefreshAttempts = 0;
  const dateFormatter = new Intl.DateTimeFormat(locale.startsWith('zh') ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  if (billingReturnState.success || billingReturnState.canceled) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
  }

  function stopGoogleRenderRetry() {
    if (googleRenderRetryTimer) {
      window.clearInterval(googleRenderRetryTimer);
      googleRenderRetryTimer = null;
    }
  }

  function stopBillingRefreshPoll() {
    if (billingRefreshTimer) {
      window.clearTimeout(billingRefreshTimer);
      billingRefreshTimer = null;
    }
    billingRefreshAttempts = 0;
  }

  function startBillingRefreshPoll() {
    if (!billingReturnState.success || billingRefreshTimer || !authState?.authenticated) {
      return;
    }

    if (authMessage) {
      authMessage.textContent = locale.startsWith('zh')
        ? '支付已返回，正在同步订阅状态…'
        : 'Billing returned. Syncing subscription status…';
    }

    const maxAttempts = 15;

    const tick = async () => {
      if (!billingReturnState.success || !authState?.authenticated) {
        stopBillingRefreshPoll();
        return;
      }

      try {
        const response = await fetch('/api/me', { credentials: 'include' });
        const payload = await parseApiJson(response, '/api/me');
        renderAuth(payload);

        if (payload.subscription?.active) {
          stopBillingRefreshPoll();
          if (authMessage) {
            authMessage.textContent = '';
          }
          return;
        }
      } catch (error) {
        console.error('Billing status refresh failed', error);
      }

      billingRefreshAttempts += 1;
      if (billingRefreshAttempts >= maxAttempts) {
        stopBillingRefreshPoll();
        return;
      }

      billingRefreshTimer = window.setTimeout(tick, 2000);
    };

    billingRefreshAttempts = 0;
    billingRefreshTimer = window.setTimeout(tick, 1200);
  }

  function startGoogleRenderRetry() {
    if (googleRenderRetryTimer || authState?.authenticated) {
      return;
    }

    let attempts = 0;
    googleRenderRetryTimer = window.setInterval(async () => {
      attempts += 1;
      const ready = await ensureGoogleClient();
      if (ready && googleSignInMount) {
        await renderGoogleButton();
        stopGoogleRenderRetry();
        return;
      }

      if (attempts >= 20) {
        stopGoogleRenderRetry();
        if (authMessage) {
          authMessage.textContent = locale.startsWith('zh')
            ? 'Google 登录正在加载，请稍后重试。'
            : 'Google sign-in is still loading. Please try again shortly.';
        }
      }
    }, 500);
  }

  function getUsageCopy(usage) {
    if (!usage) {
      return copy.usageEmpty;
    }

    if (authState?.authenticated && authState?.subscription?.active) {
      if (usage.lastGeneratedAt) {
        return `${copy.usageSummary(usage.totalGenerations)} · ${copy.usageLast(dateFormatter.format(new Date(usage.lastGeneratedAt)))}`;
      }
      return copy.usageSummary(usage.totalGenerations);
    }

    if (typeof usage.freeUsesLeft === 'number') {
      const label = usage.freeUsesLeft > 0 ? copy.freePlan(usage.freeUsesLeft) : copy.freeQuotaUsed;
      if (usage.totalGenerations > 0) {
        return `${label} · ${copy.usageSummary(usage.totalGenerations)}`;
      }
      return label;
    }

    return copy.usageEmpty;
  }

  async function ensureGoogleClient() {
    if (!useGoogleWidget) {
      return false;
    }

    await ensureGoogleScript();

    if (!googleClientId || !window.google?.accounts?.id) {
      return false;
    }

    if (!googleInitPromise) {
      googleInitPromise = Promise.resolve(
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            try {
              if (!response?.credential) {
                throw new Error(locale.startsWith('zh') ? 'Google 没有返回登录凭证' : 'Google did not return a sign-in credential');
              }

              if (authMessage) {
                authMessage.textContent = '';
              }
              subscriptionState.textContent = locale.startsWith('zh') ? '正在完成登录…' : 'Completing sign-in…';
              const result = await fetch('/api/auth/google/credential', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ credential: response.credential })
              });

              const payload = await parseApiJson(result, '/api/auth/google/credential');
              if (!result.ok) {
                throw new Error(payload.error || 'Google sign-in failed');
              }
              renderAuth(payload);
              subscriptionState.textContent = locale.startsWith('zh')
                ? '登录成功，正在同步账号信息…'
                : 'Signed in. Syncing account state…';
              await loadAuthState();
            } catch (error) {
              googleSignInMount?.classList.add('hidden');
              loginBtn.classList.remove('hidden');
              loginBtn.textContent = locale.startsWith('zh') ? '重新登录' : 'Try sign in again';
              const message = error.message || copy.authFailed;
              subscriptionState.textContent = message;
              if (authMessage) {
                authMessage.textContent = message;
              }
              console.error('Google sign-in failed', error);
            }
          }
        })
      );
    }

    await googleInitPromise;
    return true;
  }

  async function renderGoogleButton() {
    const ready = await ensureGoogleClient();
    if (!ready || !googleSignInMount) {
      startGoogleRenderRetry();
      return false;
    }

    if (!googleSignInMount.childElementCount) {
      window.google.accounts.id.renderButton(googleSignInMount, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: locale.startsWith('zh') ? 'signin_with' : 'signin_with',
        logo_alignment: 'left',
        width: 240
      });
    }

    googleSignInMount.classList.remove('hidden');
    loginBtn.classList.add('hidden');
    stopGoogleRenderRetry();
    return true;
  }

  function renderAuth(state) {
    authState = state;
    window.__imgcraftAuthState = state;
    window.__imgcraftBillingState = {
      authenticated: Boolean(state.authenticated),
      subscribed: Boolean(state.subscription?.active),
      freeUsesLeft: state.usage?.freeUsesLeft ?? 0,
      isWhitelisted: Boolean(state.user?.isWhitelisted),
      isAdmin: Boolean(state.user?.isAdmin)
    };
    loginBtn.textContent = copy.login;
    logoutBtn.textContent = copy.logout;
    subscribeBtn.classList.remove('hidden');
    adminBtn?.classList.add('hidden');
    if (authLabel) {
      authLabel.textContent = '';
    }
    if (authMessage) {
      authMessage.textContent = '';
    }

    const usage = state.usage || null;
    const planIsActive = Boolean(state.subscription?.active);
    subscribeBtn.textContent = state.authenticated
      ? planIsActive
        ? copy.managePlan
        : copy.buyPlan
      : copy.buyPlan;

    if (!state.authenticated) {
      authStatus.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      loginBtn.classList.remove('hidden');
      googleSignInMount?.classList.add('hidden');
      subscribeBtn.disabled = false;
      whitelistBadge?.classList.add('hidden');
      if (authEmail) {
        authEmail.textContent = '';
      }
      if (trialCountState) {
        trialCountState.textContent = locale.startsWith('zh') ? '3 次免费' : '3 free';
      }
      subscriptionState.textContent = copy.signedOut;
      if (usageState) {
        usageState.textContent = copy.usageSignedOut;
      }
      return;
    }

    authStatus.classList.remove('hidden');
    loginBtn.classList.add('hidden');
    googleSignInMount?.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    if (adminBtn) {
      adminBtn.textContent = copy.admin;
      adminBtn.classList.toggle('hidden', !Boolean(state.user?.isAdmin));
    }
    if (authLabel) {
      authLabel.textContent = copy.signedIn;
    }
    authName.textContent = state.user.name || state.user.email;
    if (authEmail) {
      authEmail.textContent = state.user.email || '';
    }
    if (state.user.avatarUrl) {
      authAvatar.src = state.user.avatarUrl;
      authAvatar.classList.remove('hidden');
    }

    const freeUsesLeft = usage?.freeUsesLeft ?? 0;
    const totalGenerations = usage?.totalGenerations ?? 0;
    const isWhitelisted = Boolean(state.user?.isWhitelisted);
    const activeFreeAccess = planIsActive || freeUsesLeft > 0 || isWhitelisted;
    const billingBypass = isWhitelisted && !planIsActive;
    subscribeBtn.classList.remove('hidden');
    navSubscribeBtn?.classList.remove('hidden');
    if (whitelistBadge) {
      whitelistBadge.textContent = copy.whitelistActive;
      whitelistBadge.classList.toggle('hidden', !isWhitelisted);
    }
    if (trialCountState) {
      trialCountState.textContent = planIsActive
        ? copy.activeSub
        : isWhitelisted
          ? copy.whitelistActive
          : locale.startsWith('zh')
          ? `免费 ${freeUsesLeft} 次`
          : `${freeUsesLeft} free generations left`;
    }

    subscriptionState.textContent = planIsActive
      ? `${copy.activeSub}${state.subscription.expiresAt ? ` · ${copy.planSuffix} ${new Date(state.subscription.expiresAt).toLocaleDateString()}` : ''}`
      : billingBypass
        ? `${copy.whitelistActive} · ${copy.whitelistNoBilling}`
        : freeUsesLeft > 0
        ? `${copy.freePlan(freeUsesLeft)} · ${copy.subscribePrompt}`
        : copy.freeQuotaUsed;

    if (usageState) {
      usageState.textContent = getUsageCopy({
        ...usage,
        totalGenerations,
        freeUsesLeft
      });
    }

    subscribeBtn.disabled = false;
    subscribeBtn.textContent = state.authenticated
      ? planIsActive
        ? copy.managePlan
        : copy.buyPlan
      : copy.buyPlan;
    if (confirmBtn) {
      confirmBtn.textContent = !state.authenticated
        ? copy.signInToGenerate
        : activeFreeAccess
          ? copy.generateBtn
          : copy.subscribeToContinue;
    }
  }

  async function loadAuthState() {
    subscriptionState.textContent = copy.checking;
    try {
      const response = await fetch('/api/me', { credentials: 'include' });
      const payload = await parseApiJson(response, '/api/me');
      renderAuth(payload);
      if (useGoogleWidget && !payload.authenticated) {
        await renderGoogleButton().catch(() => {});
      }

      const pendingBillingAction = sessionStorage.getItem('imgcraftPendingBillingAction');
      if (pendingBillingAction && payload.authenticated) {
        sessionStorage.removeItem('imgcraftPendingBillingAction');
        if (!billingInProgress && !billingReturnState.success && !billingReturnState.canceled) {
          const needsPortal = Boolean(payload.subscription?.active);
          await (needsPortal ? startPortalFlow : startCheckoutFlow)();
        }
      }

      if (billingReturnState.success && payload.authenticated) {
        if (payload.subscription?.active) {
          stopBillingRefreshPoll();
        } else {
          startBillingRefreshPoll();
        }
      } else if (billingReturnState.canceled && payload.authenticated && !payload.subscription?.active && authMessage) {
        authMessage.textContent = locale.startsWith('zh')
          ? '支付已取消，仍可继续使用免费额度或重新订阅。'
          : 'Billing was canceled. You can continue on the free tier or subscribe again.';
      }
    } catch {
      subscriptionState.textContent = copy.authFailed;
      if (useGoogleWidget) {
        await renderGoogleButton().catch(() => {});
      }
    }
  }

  loginBtn.addEventListener('click', () => {
    window.location.href = '/api/auth/google/start';
  });

  logoutBtn.addEventListener('click', async () => {
    stopBillingRefreshPoll();
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    renderAuth({ authenticated: false });
  });

  adminBtn?.addEventListener('click', () => {
    window.location.href = '/admin/';
  });

  async function startCheckoutFlow() {
    stopBillingRefreshPoll();
    subscribeBtn.disabled = true;
    subscribeBtn.textContent = copy.buying;
    billingInProgress = true;
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const payload = await parseApiJson(response, '/api/create-checkout-session');
      if (payload.skipped) {
        if (authMessage) {
          authMessage.textContent = payload.message || (locale.startsWith('zh')
            ? '白名单账号无需订阅。'
            : 'Whitelisted accounts do not need billing.');
        }
        return;
      }
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw new Error(payload.error || 'Request failed');
    } finally {
      billingInProgress = false;
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = authState?.subscription?.active ? copy.managePlan : copy.buyPlan;
    }
  }

  async function startPortalFlow() {
    stopBillingRefreshPoll();
    subscribeBtn.disabled = true;
    subscribeBtn.textContent = copy.managing;
    billingInProgress = true;
    try {
      const response = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const payload = await parseApiJson(response, '/api/create-portal-session');
      if (payload.skipped) {
        if (authMessage) {
          authMessage.textContent = payload.message || (locale.startsWith('zh')
            ? '白名单账号无需打开支付页面。'
            : 'Whitelisted accounts do not need billing.');
        }
        return;
      }
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw new Error(payload.error || 'Request failed');
    } finally {
      billingInProgress = false;
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = authState?.subscription?.active ? copy.managePlan : copy.buyPlan;
    }
  }

  window.__imgcraftStartCheckout = startCheckoutFlow;
  window.__imgcraftStartPortal = startPortalFlow;

  subscribeBtn.addEventListener('click', async () => {
    if (!authState?.authenticated) {
      sessionStorage.setItem('imgcraftPendingBillingAction', 'checkout');
      if (authMessage) {
        authMessage.textContent = locale.startsWith('zh') ? '正在跳转到 Google 登录…' : 'Redirecting to Google sign-in…';
      }
      window.location.href = '/api/auth/google/start';
      return;
    }

    if (authState.subscription?.active) {
      await startPortalFlow();
      return;
    }

    await startCheckoutFlow();
  });

  navSubscribeBtn?.addEventListener('click', () => {
    subscribeBtn.click();
  });

  loadAuthState();

  window.__imgcraftRefreshUsage = () => loadAuthState();
}

initAuthConsole();

function initSeoTool() {
  if (!toolRoot) {
    return;
  }
  const hasThree = typeof window.THREE !== 'undefined';

  const copy = locale.startsWith('zh')
    ? {
        fileType: '请上传图片文件',
        fileSize: '图片大小不能超过 8MB',
        noImage: '请先上传图片',
        generating: '生成中...',
        failed: '生成失败',
        complete: '完成',
        promptLabel: '相机位置坐标'
      }
    : {
        fileType: 'Please upload an image file',
        fileSize: 'Image size must be under 8MB',
        noImage: 'Please upload an image first',
        generating: 'Generating...',
        failed: 'Generation failed',
        complete: 'Done',
        promptLabel: 'Camera position'
      };

  let scene;
  let camera;
  let renderer;
  let imagePlane;
  let imageStageFrame;
  let cameraModel;
  let currentImageBase64 = '';

  const canvasContainer = document.getElementById('canvas-container');
  const canvasPreview = document.getElementById('canvasPreview3D');
  const uploadZone = document.getElementById('uploadZone3D');
  const fileInput = document.getElementById('fileInput3D');
  const confirmBtn = document.getElementById('confirm3DBtn');
  const resetBtn = document.getElementById('resetRotation');
  const promptDisplay = document.getElementById('promptDisplay');
  const generatedPrompt = document.getElementById('generatedPrompt');
  const resultImage = document.getElementById('resultImage3D');
  const resultPlaceholder = document.getElementById('resultPlaceholder3D');
  const progressContainer = document.getElementById('progressContainer3D');
  const progressFill = document.getElementById('progressFill3D');
  const progressText = document.getElementById('progressText3D');
  const xRotSlider = document.getElementById('xRot');
  const yRotSlider = document.getElementById('yRot');
  const zRotSlider = document.getElementById('zRot');
  const xRotValue = document.getElementById('xRotValue');
  const yRotValue = document.getElementById('yRotValue');
  const zRotValue = document.getElementById('zRotValue');

  const openGoogleSignIn = async () => {
    window.location.href = '/api/auth/google/start';
    return false;
  };

  if (toolStatus) {
    toolStatus.classList.remove('hidden');
  }

  const setProgress = (value, label) => {
    progressFill.style.width = `${value}%`;
    progressText.textContent = label ?? `${value}%`;
  };

  const resetConfirmButton = () => {
    confirmBtn.disabled = false;
    confirmBtn.textContent = locale.startsWith('zh') ? '生成角度' : 'Generate angle';
  };

  const syncSliderLabels = () => {
    xRotValue.textContent = `${xRotSlider.value}°`;
    yRotValue.textContent = `${yRotSlider.value}°`;
    zRotValue.textContent = Number(zRotSlider.value).toFixed(1);
  };

  function updateCameraRotation() {
    if (!cameraModel) {
      return;
    }

    const xAngle = (parseFloat(xRotSlider.value) * Math.PI) / 180;
    const yAngle = (parseFloat(yRotSlider.value) * Math.PI) / 180;
    const distance = parseFloat(zRotSlider.value);
    const posX = distance * Math.sin(yAngle) * Math.cos(xAngle);
    const posY = -distance * Math.sin(xAngle);
    const posZ = distance * Math.cos(yAngle) * Math.cos(xAngle);
    cameraModel.position.set(posX, posY, posZ);
    cameraModel.lookAt(0, 0, 0);
  }

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  function disposeMaterial(material) {
    if (!material) {
      return;
    }

    if (material.map) {
      material.map.dispose?.();
    }
    if (material.emissiveMap) {
      material.emissiveMap.dispose?.();
    }
    if (material.roughnessMap) {
      material.roughnessMap.dispose?.();
    }
    material.dispose?.();
  }

  function disposeObject3D(root) {
    if (!root) {
      return;
    }

    root.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose?.();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(child.material);
        }
      }
    });
  }

  function init3D() {
    scene = new window.THREE.Scene();
    scene.background = new window.THREE.Color(0x0c1018);

    const width = canvasContainer.clientWidth || 520;
    const height = canvasContainer.clientHeight || 340;

    camera = new window.THREE.PerspectiveCamera(38, width / height, 0.1, 1000);
    camera.position.set(4.1, 2.6, 5.2);
    camera.lookAt(0, -0.15, 0);

    renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.classList.add('hidden');
    canvasContainer.appendChild(renderer.domElement);

    const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.88);
    const directionalLight = new window.THREE.DirectionalLight(0xffffff, 1.05);
    directionalLight.position.set(3, 4, 5);
    scene.add(ambientLight, directionalLight);

    const axesHelper = new window.THREE.AxesHelper(2.6);
    const gridHelper = new window.THREE.GridHelper(10, 20, 0x3b4265, 0x22263b);
    gridHelper.position.y = -1.45;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.54;
    scene.add(axesHelper, gridHelper);

    const stageEdgesGeometry = new window.THREE.EdgesGeometry(new window.THREE.BoxGeometry(5.2, 3.2, 5.2));
    const stageFrame = new window.THREE.LineSegments(
      stageEdgesGeometry,
      new window.THREE.LineBasicMaterial({
        color: 0x40527f,
        transparent: true,
        opacity: 0.38
      })
    );
    stageFrame.position.y = -0.1;
    scene.add(stageFrame);

    const originRing = new window.THREE.Mesh(
      new window.THREE.TorusGeometry(0.18, 0.02, 10, 40),
      new window.THREE.MeshBasicMaterial({
        color: 0x6c87ff,
        transparent: true,
        opacity: 0.88
      })
    );
    originRing.rotation.x = Math.PI / 2;
    originRing.position.set(0, -1.45, 0);
    scene.add(originRing);

    const originDot = new window.THREE.Mesh(
      new window.THREE.SphereGeometry(0.045, 16, 16),
      new window.THREE.MeshBasicMaterial({
        color: 0xf2f5ff,
        transparent: true,
        opacity: 0.95
      })
    );
    originDot.position.set(0, -1.45, 0);
    scene.add(originDot);

    cameraModel = new window.THREE.Group();

    const bodyGeom = new window.THREE.BoxGeometry(0.2, 0.15, 0.15);
    const bodyMat = new window.THREE.MeshPhongMaterial({ color: 0xf0c24f, shininess: 90 });
    const body = new window.THREE.Mesh(bodyGeom, bodyMat);
    cameraModel.add(body);

    const lensGeom = new window.THREE.CylinderGeometry(0.05, 0.06, 0.1, 16);
    const lensMat = new window.THREE.MeshPhongMaterial({ color: 0x24242c, shininess: 90 });
    const lens = new window.THREE.Mesh(lensGeom, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.1;
    cameraModel.add(lens);

    scene.add(cameraModel);
    updateCameraRotation();
    animate();
  }

  function createImagePlane(imageUrl) {
    if (!hasThree) {
      if (canvasPreview) {
        canvasPreview.src = imageUrl;
        canvasPreview.classList.remove('hidden');
      }
      confirmBtn.disabled = false;
      return;
    }

    if (!scene) {
      init3D();
    }

    if (imagePlane) {
      scene.remove(imagePlane);
      disposeObject3D(imagePlane);
      imagePlane = null;
    }

    const textureLoader = new window.THREE.TextureLoader();
    textureLoader.load(imageUrl, (texture) => {
      texture.colorSpace = window.THREE.SRGBColorSpace ?? texture.colorSpace;
      const aspect = texture.image.width / texture.image.height;
      const scale = 1.18;
      const thickness = 0.09;
      const width = aspect * scale;
      const height = scale;

      const materials = [
        new window.THREE.MeshPhongMaterial({ color: 0x101521, shininess: 16 }),
        new window.THREE.MeshPhongMaterial({ color: 0x101521, shininess: 16 }),
        new window.THREE.MeshPhongMaterial({ color: 0x101521, shininess: 16 }),
        new window.THREE.MeshPhongMaterial({ color: 0x101521, shininess: 16 }),
        new window.THREE.MeshBasicMaterial({ map: texture, transparent: true }),
        new window.THREE.MeshPhongMaterial({ color: 0x101521, shininess: 16 })
      ];
      const cardGeometry = new window.THREE.BoxGeometry(width, height, thickness);
      const card = new window.THREE.Mesh(cardGeometry, materials);
      const cardEdges = new window.THREE.EdgesGeometry(cardGeometry);
      const cardOutline = new window.THREE.LineSegments(
        cardEdges,
        new window.THREE.LineBasicMaterial({
          color: 0xbfd0ff,
          transparent: true,
          opacity: 0.92
        })
      );

      imagePlane = new window.THREE.Group();
      imagePlane.add(card, cardOutline);
      imagePlane.rotation.set(-0.16, -0.12, 0.04);
      imagePlane.position.set(0.12, -0.04, 0.02);
      scene.add(imagePlane);
      canvasPreview?.classList.add('hidden');
      renderer?.domElement?.classList.remove('hidden');
      confirmBtn.disabled = false;
    });
  }

  function compressImage(base64, maxWidth = 1400, quality = 0.9) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = base64;
    });
  }

  async function readErrorMessage(response) {
    const raw = await response.text();

    if (!raw) {
      return `${copy.failed}: ${response.status}`;
    }

    try {
      const payload = JSON.parse(raw);
      const message =
        payload?.error?.message ||
        payload?.error?.msg ||
        payload?.error ||
        payload?.message ||
        payload?.detail;
      if (message) {
        return `${copy.failed}: ${message}`;
      }
    } catch {
      // Fall through to raw text below.
    }

    return `${copy.failed}: ${raw}`;
  }

  function buildPrompt() {
    return buildAnglePrompt({
      xRot: xRotSlider.value,
      yRot: yRotSlider.value,
      zDist: zRotSlider.value,
      locale
    });
  }

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert(copy.fileType);
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      alert(copy.fileSize);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      currentImageBase64 = event.target.result;
      if (toolStatus) {
        toolStatus.textContent = locale.startsWith('zh')
          ? '图片已加载，可以点击生成。'
          : 'Image loaded. You can generate now.';
        toolStatus.classList.remove('is-error');
        toolStatus.classList.add('is-success');
      }
      createImagePlane(currentImageBase64);
    };
    reader.readAsDataURL(file);
  }

  uploadZone?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  });

  [xRotSlider, yRotSlider, zRotSlider].forEach((slider) => {
    slider?.addEventListener('input', () => {
      syncSliderLabels();
      updateCameraRotation();
    });
  });

  resetBtn?.addEventListener('click', () => {
    xRotSlider.value = 0;
    yRotSlider.value = 0;
    zRotSlider.value = 2;
    syncSliderLabels();
    updateCameraRotation();
  });

  confirmBtn?.addEventListener('click', async () => {
    try {
      if (toolStatus) {
        toolStatus.textContent = locale.startsWith('zh') ? '已点击生成，正在检查状态…' : 'Generate clicked. Checking state…';
        toolStatus.classList.remove('is-error');
        toolStatus.classList.add('is-success');
      }
      confirmBtn.textContent = locale.startsWith('zh') ? '检查中…' : 'Checking…';

      if (!authState?.authenticated) {
        if (toolStatus) {
          toolStatus.textContent = locale.startsWith('zh')
            ? '请先登录后再生成。'
            : 'Please sign in before generating.';
          toolStatus.classList.remove('is-success');
          toolStatus.classList.add('is-error');
        }
        sessionStorage.setItem('imgcraftPendingBillingAction', 'checkout');
        await openGoogleSignIn();
        return;
      }

      if (!currentImageBase64) {
        if (toolStatus) {
          toolStatus.textContent = copy.noImage;
          toolStatus.classList.remove('is-success');
          toolStatus.classList.add('is-error');
        }
        return;
      }

      const isWhitelisted = Boolean(authState?.user?.isWhitelisted);
      if (!authState.subscription?.active && !isWhitelisted && (authState.usage?.freeUsesLeft ?? 0) <= 0) {
        if (toolStatus) {
          toolStatus.textContent = locale.startsWith('zh')
            ? '免费额度已用完，请点右上角订阅继续。'
            : 'Your free generations are used up. Use the Subscribe button to continue.';
          toolStatus.classList.remove('is-success');
          toolStatus.classList.add('is-error');
        }
        sessionStorage.setItem('imgcraftPendingBillingAction', 'checkout');
        return;
      }

      const fullPrompt = buildPrompt();
      if (!generatedPrompt || !promptDisplay) {
        throw new Error('Prompt panel is missing from the page');
      }
      generatedPrompt.textContent = fullPrompt;
      promptDisplay.classList.remove('hidden');
      if (toolStatus) {
        toolStatus.textContent = locale.startsWith('zh') ? '正在生成，请稍候…' : 'Generating, please wait…';
        toolStatus.classList.remove('is-error');
        toolStatus.classList.add('is-success');
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = copy.generating;
      progressContainer.classList.remove('hidden');
      setProgress(16);

      const compressedBase64 = await compressImage(currentImageBase64);
      const base64Data = compressedBase64.split(',')[1];
      setProgress(42);

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60000);

      const response = await fetch('/api/seedream-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          image: `data:image/jpeg;base64,${base64Data}`,
          meta: {
            x: xRotSlider.value,
            y: yRotSlider.value,
            z: zRotSlider.value
          }
        }),
        signal: controller.signal
      });

      window.clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = await parseApiJson(response, '/api/seedream-proxy');
      const imageUrl = data?.data?.[0]?.url || data?.data?.[0]?.base64 || data?.url;

      if (!imageUrl) {
        throw new Error(copy.failed);
      }

      resultImage.src = imageUrl;
      resultImage.classList.remove('hidden');
      resultPlaceholder.classList.add('hidden');
      setProgress(100, copy.complete);

      if (typeof window.__imgcraftRefreshUsage === 'function') {
        window.__imgcraftRefreshUsage();
      }
    } catch (error) {
      console.error('generate-angle failed', error);
      const message = `${copy.failed}: ${error.message}`;
      if (toolStatus) {
        toolStatus.textContent = message;
        toolStatus.classList.remove('is-success');
        toolStatus.classList.add('is-error');
      } else {
        alert(message);
      }
    } finally {
      resetConfirmButton();
      window.setTimeout(() => progressContainer.classList.add('hidden'), 1200);
    }
  });

  confirmBtn?.addEventListener('pointerdown', () => {
    if (toolStatus) {
      toolStatus.textContent = locale.startsWith('zh') ? '按钮已按下…' : 'Button pressed…';
      toolStatus.classList.remove('is-error');
      toolStatus.classList.add('is-success');
    }
  });

  const onResize = () => {
    if (!renderer || !camera) {
      return;
    }

    const width = canvasContainer.clientWidth || 520;
    const height = canvasContainer.clientHeight || 340;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  window.addEventListener('resize', onResize);
  syncSliderLabels();
  if (hasThree) {
    init3D();
  }
}

initSeoTool();
