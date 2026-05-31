export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Missing code" });
  try {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });
    const data = await response.json();
    if (data.errors) return res.status(400).json({ error: "Strava error" });
    return res.status(200).json({
      access_token: data.access_token,
      athlete: { id: data.athlete?.id, firstname: data.athlete?.firstname, lastname: data.athlete?.lastname },
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", message: err.message });
  }
}
