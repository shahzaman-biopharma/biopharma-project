// Redirects to Microsoft OAuth login.
// Admin opens this URL once to get a refresh_token for permanent OneDrive access.

export default function handler(req, res) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send(
      '<html><body style="font-family:sans-serif;padding:30px;background:#0f172a;color:#f87171">' +
      '<h2>MICROSOFT_CLIENT_ID not set in Vercel environment variables.</h2>' +
      '<p>Add it first, then redeploy.</p></body></html>'
    );
  }

  const redirectUri = `https://${req.headers.host}/api/ms-callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'Files.Read offline_access User.Read',
    response_mode: 'query',
    prompt: 'select_account',
  });

  res.redirect(302, `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
}
