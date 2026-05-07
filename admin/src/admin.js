const googleClientId = document.querySelector('meta[name="google-client-id"]')?.content || '';
const loginCard = document.getElementById('loginCard');
const panelCard = document.getElementById('panelCard');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const userRows = document.getElementById('userRows');
const statusLine = document.getElementById('statusLine');
const googleSignInMount = document.getElementById('googleSignInMount');
// Force the redirect-based Google sign-in flow in all environments.
// This avoids Google GIS origin restrictions during local development and previews.
const useGoogleWidget = false;

let googleInitPromise = null;
let adminState = null;
let googleScriptPromise = null;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function parseApiJson(response, endpoint) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  const contentType = response.headers.get('content-type') || '';
  const looksLikeJson = contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[');
  if (!looksLikeJson) {
    throw new Error(`Endpoint ${endpoint} returned non-JSON content. Make sure the backend API is running.`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON from ${endpoint}. Check backend response format.`);
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

function setStatus(message) {
  if (statusLine) {
    statusLine.textContent = message;
  }
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
          if (!response?.credential) {
            return;
          }

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

          await loadAdminState();
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
    return false;
  }

  if (!googleSignInMount.childElementCount) {
    window.google.accounts.id.renderButton(googleSignInMount, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      logo_alignment: 'left',
      width: 240
    });
  }

  googleSignInMount.classList.remove('hidden');
  loginBtn.classList.add('hidden');
  return true;
}

function fmtDate(value) {
  if (!value) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function renderUsers(users) {
  if (!userRows) {
    return;
  }

  if (!users.length) {
    userRows.innerHTML = '<tr><td colspan="5">No users found.</td></tr>';
    return;
  }

  userRows.innerHTML = users
    .map((user) => {
      const subscriptionLabel = user.subscriptionActive ? 'Active plan' : user.isWhitelisted ? 'Whitelist bypass' : 'Free';
      const subscriptionBadgeClass = user.subscriptionActive ? 'ok' : user.isWhitelisted ? 'warn' : '';
      const whitelistLabel = user.isWhitelisted ? 'Yes' : 'No';
      return `
        <tr>
          <td>
            <strong>${user.email || 'Unknown'}</strong>
            <div class="admin-status">${user.name || ''}</div>
            <div class="admin-status">${user.id}</div>
          </td>
          <td><span class="admin-badge ${subscriptionBadgeClass}">${subscriptionLabel}</span></td>
          <td>
            <strong>${user.totalGenerations}</strong>
            <div class="admin-status">${user.freeUsesLeft} free left</div>
            <div class="admin-status">Last: ${fmtDate(user.lastGeneratedAt)}</div>
          </td>
          <td>
            <label>
              <input type="checkbox" data-user-id="${user.id}" ${user.isWhitelisted ? 'checked' : ''} />
              ${whitelistLabel}
            </label>
          </td>
          <td class="admin-status">${fmtDate(user.updatedAt)}</td>
        </tr>
      `;
    })
    .join('');

  userRows.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (event) => {
      const target = event.currentTarget;
      const userId = target.getAttribute('data-user-id');
      if (!userId) {
        return;
      }

      target.disabled = true;
      try {
        const response = await fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ isWhitelisted: target.checked })
        });
        const payload = await parseApiJson(response, `/api/admin/users/${userId}`);
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to update user');
        }
        await loadUsers();
      } catch (error) {
        target.checked = !target.checked;
        setStatus(error.message || 'Failed to update user');
      } finally {
        target.disabled = false;
      }
    });
  });
}

async function loadUsers() {
  const query = searchInput?.value.trim() || '';
  setStatus('Loading users…');
  const response = await fetch(`/api/admin/users${query ? `?query=${encodeURIComponent(query)}` : ''}`, {
    credentials: 'include'
  });
  const payload = await parseApiJson(response, '/api/admin/users');
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load users');
  }
  adminState = payload;
  renderUsers(payload.users || []);
  setStatus(`${payload.users?.length || 0} users`);
}

async function loadAdminState() {
  try {
    let payload = null;
    let response = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch('/api/admin/me', { cache: 'no-store', credentials: 'include' });
      payload = await parseApiJson(response, '/api/admin/me');
      if (response.ok && payload.authenticated && payload.isAdmin) {
        break;
      }
      await delay(250);
    }

    if (!response || !response.ok || !payload?.authenticated || !payload?.isAdmin) {
      loginCard?.classList.remove('hidden');
      panelCard?.classList.add('hidden');
      loginBtn?.classList.remove('hidden');
      googleSignInMount?.classList.add('hidden');
      setStatus('Admin access required.');
      await renderGoogleButton().catch(() => {});
      return;
    }

    loginCard?.classList.add('hidden');
    panelCard?.classList.remove('hidden');
    setStatus('Loading users…');
    try {
      await loadUsers();
    } catch (error) {
      setStatus(error.message || 'Failed to load users');
    }
  } catch (error) {
    loginCard?.classList.remove('hidden');
    panelCard?.classList.add('hidden');
    loginBtn?.classList.remove('hidden');
    setStatus(error.message || 'Failed to load admin state');
    await renderGoogleButton().catch(() => {});
  }
}

loginBtn?.addEventListener('click', () => {
  renderGoogleButton()
    .then((ready) => {
      if (!ready) {
        window.location.href = '/api/auth/google/start';
      }
    })
    .catch(() => {
      window.location.href = '/api/auth/google/start';
    });
});

logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.reload();
});

refreshBtn?.addEventListener('click', () => {
  loadUsers().catch((error) => setStatus(error.message || 'Failed to refresh users'));
});

searchInput?.addEventListener('input', () => {
  loadUsers().catch((error) => setStatus(error.message || 'Failed to search users'));
});

await loadAdminState();
