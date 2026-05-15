// Microsoft OAuth callback — exchanges code for tokens.
// Shows the refresh_token so admin can add it to Vercel env vars.

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(page('❌ Login Failed',
      `<p style="color:#f87171">${error}: ${error_description || ''}</p>`
    ));
  }
  if (!code) {
    return res.status(400).send(page('❌ No Code', '<p style="color:#f87171">No authorization code received.</p>'));
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send(page('❌ Missing Config',
      '<p style="color:#f87171">MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not set in Vercel.</p>'
    ));
  }

  const redirectUri = `https://${req.headers.host}/api/ms-callback`;

  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'Files.Read offline_access User.Read',
      }),
    });

    const data = await tokenRes.json();

    if (!data.refresh_token) {
      return res.status(400).send(page('❌ Token Error',
        `<p style="color:#f87171">Failed to get refresh token.</p><pre style="color:#94a3b8;font-size:12px">${JSON.stringify(data, null, 2)}</pre>`
      ));
    }

    res.send(page('✓ Microsoft Connected!', `
      <p style="color:#94a3b8;margin-bottom:20px">
        Copy the value below and add it to <strong style="color:#e2e8f0">Vercel → Settings → Environment Variables</strong>:
      </p>

      <div style="margin-bottom:16px">
        <p style="color:#94a3b8;font-size:13px;margin-bottom:6px">Variable name:</p>
        <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;font-size:14px;color:#34d399;letter-spacing:1px">
          MICROSOFT_REFRESH_TOKEN
        </div>
      </div>

      <div style="margin-bottom:24px">
        <p style="color:#94a3b8;font-size:13px;margin-bottom:6px">Value (select all and copy):</p>
        <textarea
          id="rt"
          readonly
          onclick="this.select()"
          style="width:100%;height:130px;background:#1e293b;color:#f1f5f9;border:1px solid #334155;padding:12px;border-radius:8px;font-size:11px;resize:none;box-sizing:border-box"
        >${data.refresh_token}</textarea>
        <button
          onclick="navigator.clipboard.writeText(document.getElementById('rt').value).then(()=>this.textContent='Copied!')"
          style="margin-top:8px;padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px"
        >Copy to Clipboard</button>
      </div>

      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:16px">
        <p style="color:#34d399;font-weight:600;margin:0 0 8px">Next steps:</p>
        <ol style="color:#94a3b8;margin:0;padding-left:20px;line-height:1.8;font-size:13px">
          <li>Go to <strong style="color:#e2e8f0">Vercel → your project → Settings → Environment Variables</strong></li>
          <li>Add <code style="color:#34d399">MICROSOFT_REFRESH_TOKEN</code> with the value above</li>
          <li>Click <strong style="color:#e2e8f0">Redeploy</strong> from the Deployments tab</li>
          <li>Private OneDrive Excel files will now be permanently accessible ✓</li>
        </ol>
      </div>

      <p style="color:#475569;font-size:12px;margin-top:20px">
        This refresh token works for months/years as long as the account is active.
        If it expires, just visit <code>/api/ms-auth</code> again.
      </p>
    `));
  } catch (err) {
    res.status(500).send(page('❌ Error', `<p style="color:#f87171">${err.message}</p>`));
  }
}

function page(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
  <body style="font-family:system-ui,sans-serif;padding:40px;background:#0f172a;color:#e2e8f0;max-width:640px;margin:0 auto">
    <h2 style="color:${title.startsWith('✓') ? '#34d399' : '#f87171'};margin-bottom:20px">${title}</h2>
    ${body}
  </body></html>`;
}
