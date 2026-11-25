// Vercel serverless function: POST /api/book
// Receives a confirmed booking from the website and emails it to the team.
//
// Needs these Environment Variables in Vercel (Project → Settings → Environment Variables):
//   GMAIL_USER          the Gmail address that sends the mail
//   GMAIL_APP_PASSWORD  a 16-character Gmail "App password" (not the normal password)
//   TEAM_EMAIL          where bookings are sent (optional; defaults to GMAIL_USER)

const nodemailer = require("nodemailer");
const data = require("../prices.json");

const PAYMENT_METHODS = {
  upi: "UPI to the coordinator",
  cash: "Cash to the coordinator",
};

function rupees(n) {
  return "₹" + Number(n).toLocaleString("en-IN");
}

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Works out the services and the total on the server, from prices.json,
// so nobody can change the price by editing the page.
function priceBooking(packageId, chosenIds) {
  const pkg = data.packages.find(p => p.id === packageId);
  if (!pkg) return { error: "Unknown package" };

  let ids, total;
  if (pkg.id === "flexible") {
    const valid = new Set(data.services.map(s => s.id));
    ids = [...new Set((Array.isArray(chosenIds) ? chosenIds : []).filter(id => valid.has(id)))];
    if (ids.length === 0) return { error: "Pick at least one service" };
    total = ids.reduce((sum, id) => sum + data.services.find(s => s.id === id).price, 0);
  } else {
    ids = pkg.includes;
    total = pkg.price;
  }
  const services = ids.map(id => data.services.find(s => s.id === id));
  return { pkg, services, total };
}

function buildEmail(b) {
  const lines = [
    `Package: ${b.pkg.name} — ${rupees(b.total)}`,
    "",
    "Services:",
    ...b.services.map(s => `  • ${s.name}${b.pkg.id === "flexible" ? ` (${rupees(s.price)})` : ""}`),
    "",
    `Name: ${b.name}`,
    `Phone: ${b.phone}`,
    `Email: ${b.email || "—"}`,
    `City: ${b.city}`,
    `Address / hospital: ${b.address}`,
    `Payment: ${b.payment}`,
    `Notes: ${b.notes || "—"}`,
    "",
    `Received: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
  ];
  const text = lines.join("\n");
  const html = `<pre style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(text)}</pre>`;
  return {
    subject: `New booking: ${b.pkg.name} — ${b.name} (${b.city})`,
    text,
    html,
  };
}

async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  const name = clean(body.name, 100);
  const phone = clean(body.phone, 20);
  const email = clean(body.email, 120);
  const city = clean(body.city, 60);
  const address = clean(body.address, 300);
  const notes = clean(body.notes, 1000);
  const payment = PAYMENT_METHODS[body.payment];

  if (!name || !/^[+\d][\d\s-]{6,18}$/.test(phone) || !city || !address || !payment) {
    return res.status(400).json({ ok: false, error: "Please fill in name, a valid phone number, city, address and payment method." });
  }

  const priced = priceBooking(clean(body.package, 30), body.services);
  if (priced.error) return res.status(400).json({ ok: false, error: priced.error });

  const booking = { ...priced, name, phone, email, city, address, notes, payment };
  const mail = buildEmail(booking);

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return res.status(500).json({ ok: false, error: "Email is not set up yet. Please call us on +91 91116 48336." });
  }

  const transporter = (deps.createTransport || nodemailer.createTransport)({
    service: "gmail",
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: `"Last Mile Care Website" <${user}>`,
      to: process.env.TEAM_EMAIL || user,
      replyTo: email || undefined,
      ...mail,
    });
  } catch (err) {
    console.error("Mail failed:", err.message);
    return res.status(502).json({ ok: false, error: "We couldn't send your booking. Please call us on +91 91116 48336." });
  }

  return res.status(200).json({ ok: true, total: priced.total, package: priced.pkg.name });
}

module.exports = handler;
module.exports.priceBooking = priceBooking;
module.exports.buildEmail = buildEmail;
