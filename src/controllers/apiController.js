const { mongoose } = require('../db/mongoose');
const enquiryService = require('../services/enquiryService');
const providerService = require('../services/providerService');
const catalogService = require('../services/catalogService');
const communicationService = require('../services/communicationService');
const followUpService = require('../services/followUpService');
const billingService = require('../services/billingService');

function health(req, res) {
  res.json({
    ok: true,
    service: 'service-crm-admin',
    database: {
      connected: mongoose.connection.readyState === 1,
      name: mongoose.connection.name || null
    }
  });
}

async function createEnquiry(req, res, next) {
  try {
    const actor = req.body.actor || req.body.source?.website || req.body.sourceWebsite || 'api';
    const enquiry = await enquiryService.createEnquiry(req.body, actor);
    await maybeForwardEvent('enquiry.created', enquiry);
    res.status(201).json({ ok: true, data: enquiry });
  } catch (error) {
    next(error);
  }
}

async function listEnquiries(req, res, next) {
  try {
    const enquiries = await enquiryService.listEnquiries(req.query);
    res.json({ ok: true, data: enquiries });
  } catch (error) {
    next(error);
  }
}

async function getEnquiry(req, res, next) {
  try {
    const enquiry = await enquiryService.getEnquiry(req.params.id);
    if (!enquiry) return res.status(404).json({ ok: false, message: 'Enquiry not found' });
    res.json({ ok: true, data: enquiry });
  } catch (error) {
    next(error);
  }
}

async function assignProvider(req, res, next) {
  try {
    const enquiry = await enquiryService.assignProvider(req.params.id, req.body.providerId, req.body.actor || 'api');
    await maybeForwardEvent('enquiry.assigned', enquiry);
    res.json({ ok: true, data: enquiry });
  } catch (error) {
    next(error);
  }
}

async function listProviders(req, res, next) {
  try {
    const providers = await providerService.listProviders(req.query);
    res.json({ ok: true, data: providers });
  } catch (error) {
    next(error);
  }
}

async function listCatalog(req, res, next) {
  try {
    const [categories, templates] = await Promise.all([
      catalogService.listCategories(),
      catalogService.listTemplates(req.query)
    ]);
    res.json({ ok: true, data: { categories, templates } });
  } catch (error) {
    next(error);
  }
}

async function getFormSchema(req, res, next) {
  try {
    const schema = await catalogService.getFormSchema(req.query);
    if (!schema.template) {
      return res.status(404).json({
        ok: false,
        message: 'No active form template found for this website/category/form type',
        data: schema
      });
    }
    res.json({ ok: true, data: schema });
  } catch (error) {
    next(error);
  }
}


async function listFollowUps(req, res, next) {
  try {
    const followUps = await followUpService.listFollowUps(req.query);
    res.json({ ok: true, data: followUps });
  } catch (error) {
    next(error);
  }
}

async function getFollowUp(req, res, next) {
  try {
    const followUp = await followUpService.getFollowUp(req.params.id);
    if (!followUp) return res.status(404).json({ ok: false, message: 'Follow-up not found' });
    res.json({ ok: true, data: followUp });
  } catch (error) {
    next(error);
  }
}

async function listCommunications(req, res, next) {
  try {
    const communications = await communicationService.listCommunications(req.query);
    res.json({ ok: true, data: communications });
  } catch (error) {
    next(error);
  }
}

async function getCommunication(req, res, next) {
  try {
    const communication = await communicationService.getCommunication(req.params.id);
    if (!communication) return res.status(404).json({ ok: false, message: 'Communication not found' });
    res.json({ ok: true, data: communication });
  } catch (error) {
    next(error);
  }
}

async function listInvoices(req, res, next) {
  try {
    const invoices = await billingService.listInvoices(req.query);
    res.json({ ok: true, data: invoices });
  } catch (error) {
    next(error);
  }
}

async function getInvoice(req, res, next) {
  try {
    const invoice = await billingService.getInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ ok: false, message: 'Invoice not found' });
    res.json({ ok: true, data: invoice });
  } catch (error) {
    next(error);
  }
}

async function communicationWebhook(req, res, next) {
  try {
    const record = await communicationService.createCommunication(req.body, req.body.actor || 'api');
    res.status(201).json({ ok: true, data: record });
  } catch (error) {
    next(error);
  }
}

async function maybeForwardEvent(event, payload) {
  const url = process.env.EVENT_WEBHOOK_URL;
  if (!url) return;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.EVENT_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.EVENT_WEBHOOK_TOKEN}`;
  await fetch(url, { method: 'POST', headers, body: JSON.stringify({ event, payload }) }).catch((error) => {
    console.error('EVENT_WEBHOOK_URL failed', error.message);
  });
}

module.exports = {
  health,
  createEnquiry,
  listEnquiries,
  getEnquiry,
  assignProvider,
  listProviders,
  listCatalog,
  getFormSchema,
  listFollowUps,
  getFollowUp,
  listCommunications,
  getCommunication,
  listInvoices,
  getInvoice,
  communicationWebhook
};
