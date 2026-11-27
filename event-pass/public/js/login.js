const form = document.getElementById('login-form'), err = document.getElementById('login-error'), btn = document.getElementById('login-btn');
form.addEventListener('submit', async (e) => {
  e.preventDefault(); err.classList.add('hidden');
  const username = form.username.value.trim(), password = form.password.value;
  if (!username || !password) { err.textContent = 'Enter both username and password.'; err.classList.remove('hidden'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Login failed.');
    location.href = 'dashboard.html';
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); form.password.value = ''; form.password.focus(); }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});
