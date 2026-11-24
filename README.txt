VAMSEE Logistics Support Automation Demo
========================================

Files:
- index.html : self-contained interactive demo

Run locally:
1. Extract the ZIP.
2. Open index.html in a modern browser.

Deploy to Cloudflare:
1. Open Cloudflare Dashboard -> Workers & Pages.
2. Create application -> Pages -> Upload assets (wording may vary).
3. Upload the extracted folder containing index.html.
4. Deploy and open the generated workers.dev / pages.dev URL.

What it demonstrates:
- Sample shipment enquiry intake
- Rule-based issue classification and priority
- Suggested customer response drafts
- Operations queue and escalation flags
- Copy response action

Important limitations:
- This is a front-end demonstration using sample data and rule-based logic.
- It does not call a live AI model or courier API.
- It does not send customer messages or write to a CRM/helpdesk.
- All replies require human review before sending.
- No customer data is transmitted or stored by this demo.
