'use strict';

/**
 * Persist client signature PNG as a named attachment on the attendance record.
 * Used when the client signs via the full-screen Legal Aid Declaration pad.
 */

function buildClientSignatureAttachmentName(formData) {
  var dateStr = (formData && formData.date) || new Date().toISOString().slice(0, 10);
  var compact = String(dateStr).replace(/-/g, '');
  return 'Client_Signature_' + compact + '.png';
}

function upsertClientSignatureAttachment(formData, dataUri) {
  if (!formData || !dataUri) return null;
  if (!formData.photos) formData.photos = {};
  if (!Array.isArray(formData.photos.attachments)) formData.photos.attachments = [];

  formData.photos.attachments = formData.photos.attachments.filter(function(a) {
    return a && a.signatureKey !== 'clientSig';
  });

  var entry = {
    dataUrl: dataUri,
    name: buildClientSignatureAttachmentName(formData),
    mime: 'image/png',
    documentType: 'declaration',
    customDocumentType: 'Client signature',
    notes: 'Client signature captured from Legal Aid Declaration',
    addedAt: new Date().toISOString(),
    signatureKey: 'clientSig',
  };
  formData.photos.attachments.push(entry);
  return entry;
}

function removeClientSignatureAttachment(formData) {
  if (!formData || !formData.photos || !Array.isArray(formData.photos.attachments)) return;
  formData.photos.attachments = formData.photos.attachments.filter(function(a) {
    return !(a && a.signatureKey === 'clientSig');
  });
}

var ClientSignatureAttachment = {
  buildClientSignatureAttachmentName: buildClientSignatureAttachmentName,
  upsertClientSignatureAttachment: upsertClientSignatureAttachment,
  removeClientSignatureAttachment: removeClientSignatureAttachment,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientSignatureAttachment;
}
if (typeof window !== 'undefined') {
  window.ClientSignatureAttachment = ClientSignatureAttachment;
}
