const enquiryStatuses = ['new', 'contacted', 'assigned', 'scheduled', 'completed', 'cancelled', 'lost'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const providerStatuses = ['active', 'inactive', 'pending', 'verification_pending', 'blocked'];
const followUpStatuses = ['open', 'done', 'missed', 'cancelled'];
const invoiceStatuses = ['draft', 'sent', 'paid', 'cancelled'];
const communicationStatuses = ['logged', 'logged_local_external_failed', 'sent', 'delivered', 'failed', 'received'];

const enquiryQueues = [
  {
    key: 'new',
    label: 'New bookings',
    shortLabel: 'New',
    statuses: ['new'],
    icon: 'ph-sparkle',
    description: 'Fresh enquiries waiting for first action',
    emptyMessage: 'No new bookings are waiting right now.'
  },
  {
    key: 'contacted',
    label: 'Contacted',
    shortLabel: 'Contacted',
    statuses: ['contacted'],
    icon: 'ph-phone-call',
    description: 'Customers contacted, awaiting next step',
    emptyMessage: 'No contacted enquiries found.'
  },
  {
    key: 'assigned',
    label: 'Assigned / scheduled',
    shortLabel: 'Assigned',
    statuses: ['assigned', 'scheduled'],
    icon: 'ph-user-switch',
    description: 'Provider assigned or visit scheduled',
    emptyMessage: 'No assigned or scheduled enquiries found.'
  },
  {
    key: 'completed',
    label: 'Completed bookings',
    shortLabel: 'Completed',
    statuses: ['completed'],
    icon: 'ph-check-square',
    description: 'Closed successfully',
    emptyMessage: 'No completed bookings found.'
  },
  {
    key: 'cancelled',
    label: 'Cancelled / lost',
    shortLabel: 'Cancelled',
    statuses: ['cancelled', 'lost'],
    icon: 'ph-x-circle',
    description: 'Cancelled, lost, or not converted',
    emptyMessage: 'No cancelled or lost enquiries found.'
  }
];

function getEnquiryQueue(key) {
  return enquiryQueues.find((queue) => queue.key === key) || null;
}

function humanize(value) {
  if (!value) return '-';
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
