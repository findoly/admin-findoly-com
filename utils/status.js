const enquiryStatuses = [
  'new',
  'verification_pending',
  'verified',
  'approved',
  'in_progress',
  'completed',
  'rejected',
  'closed',
  'contacted',
  'cancelled',
  'lost'
];

const priorities = ['low', 'normal', 'high', 'urgent'];
const providerStatuses = ['active', 'inactive', 'pending', 'verification_pending', 'blocked'];
const followUpStatuses = ['open', 'done', 'missed', 'cancelled'];
const invoiceStatuses = ['draft', 'sent', 'paid', 'cancelled'];
const communicationStatuses = ['logged', 'logged_local_external_failed', 'sent', 'delivered', 'failed', 'received'];

const enquiryQueues = [
  {
    key: 'new',
    label: 'New requirements',
    shortLabel: 'New',
    statuses: ['new'],
    icon: 'ph-sparkle',
    description: 'Fresh customer requirements waiting for first review',
    emptyMessage: 'No fresh requirements are waiting right now.'
  },
  {
    key: 'verification',
    label: 'Verification queue',
    shortLabel: 'Verify',
    statuses: ['verification_pending', 'contacted', 'verified'],
    icon: 'ph-phone-call',
    description: 'Team is calling/customer-checking details before approval',
    emptyMessage: 'No requirements are pending verification.'
  },
  {
    key: 'approved',
    label: 'Approved leads',
    shortLabel: 'Approved',
    statuses: ['approved'],
    icon: 'ph-check-square',
    description: 'Verified requirements ready for final approval and internal follow-up',
    emptyMessage: 'No approved leads are waiting right now.'
  },
  {
    key: 'completed',
    label: 'Completed / closed',
    shortLabel: 'Closed',
    statuses: ['completed', 'closed'],
    icon: 'ph-check-square',
    description: 'Lead outcome is completed or administratively closed',
    emptyMessage: 'No completed or closed requirements found.'
  },
  {
    key: 'rejected',
    label: 'Rejected / invalid',
    shortLabel: 'Rejected',
    statuses: ['rejected', 'cancelled', 'lost'],
    icon: 'ph-x-circle',
    description: 'Invalid, duplicate, cancelled, or not-serviceable requirements',
    emptyMessage: 'No rejected or invalid requirements found.'
  }
];

function getEnquiryQueue(key) {
  return enquiryQueues.find((queue) => queue.key === key) || null;
}

function humanize(value) {
  if (!value) return '-';
  const aliases = {
    new: 'New',
    verification_pending: 'Verification Pending',
    contacted: 'Contacted',
    verified: 'Verified',
    approved: 'Approved',
    distributed: 'Distributed',
    assigned: 'Assigned',
    scheduled: 'Scheduled',
    in_progress: 'In Progress',
    completed: 'Completed',
    closed: 'Closed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    lost: 'Lost'
  };
  if (aliases[value]) return aliases[value];
  return String(value).replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  enquiryStatuses,
  enquiryQueues,
  getEnquiryQueue,
  priorities,
  providerStatuses,
  followUpStatuses,
  invoiceStatuses,
  communicationStatuses,
  humanize
};
