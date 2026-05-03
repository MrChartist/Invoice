import { useRef, useMemo, useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import styles from './InvoicePreview.module.css';
import { TEMPLATES } from '../templates/registry';
import { TemplateEngine } from '../templates/TemplateEngine';

interface InvoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function getSenderProfile(invoiceSender: any) {
  if (invoiceSender) return invoiceSender;

  const defaults = {
    companyName: 'Rohit Singh',
    companyEmail: 'mrchartist@zohomail.in',
    companyAddress: '73 Sagouni Post Chouka Teh Kesli\nSagar, Madhya Pradesh 470235',
    companyPhone: '7581838868',
    companyTagline: 'Financial Consultant',
    bankName: 'ICICI Bank (Savings)',
    accountName: 'ROHIT SINGH',
    accountNumber: '081801505319',
    ifsc: 'ICIC0000949',
    upiId: '8726696911@icici'
  };
  try {
    const stored = localStorage.getItem('mrchartist_inv_settings');
    if (stored) {
      const s = JSON.parse(stored);
      if (s.profiles && s.profiles.length > 0) {
        return s.profiles.find((p: any) => p.id === s.activeProfileId) || s.profiles[0];
      }
      return {
        companyName: s.companyName || defaults.companyName,
        companyEmail: s.companyEmail || defaults.companyEmail,
        companyAddress: s.companyAddress || defaults.companyAddress,
        companyPhone: s.companyPhone || defaults.companyPhone,
        companyTagline: s.companyTagline || defaults.companyTagline,
        bankName: defaults.bankName,
        accountName: defaults.accountName,
        accountNumber: defaults.accountNumber,
        ifsc: defaults.ifsc,
        upiId: defaults.upiId
      };
    }
  } catch {}
  return defaults;
}

export const InvoicePreviewModal = ({ isOpen, onClose }: InvoicePreviewModalProps) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const invoice = useInvoiceStore();
  const sender = useMemo(() => getSenderProfile(invoice.sender), [isOpen, invoice.sender]);
  const [templateId, setTemplateId] = useState(() => localStorage.getItem('mrchartist_inv_template') || 'classic_orange');

  if (!isOpen) return null;

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    localStorage.setItem('mrchartist_inv_template', id);
  };

  const handleExportPDF = async () => {
    if (!previewRef.current) return;
    try {
      const dataUrl = await toPng(previewRef.current, { quality: 1, pixelRatio: 3, cacheBust: true });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Invoice_${invoice.invoice_number || 'draft'}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, 
      backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      overflowY: 'auto', padding: '2rem 1rem'
    }}>
      {/* Toolbar */}
      <div className={`${styles.toolbar} no-print`} style={{ marginBottom: '1rem', position: 'sticky', top: 0, zIndex: 10, maxWidth: '780px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={styles.toolbarLabel}>Preview (A4)</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '320px', overflowX: 'auto', padding: '2px 0' }}>
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => handleTemplateChange(t.id)}
                title={`${t.name} (${t.category})`}
                style={{
                  width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0,
                  background: t.accent, border: templateId === t.id ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer', boxShadow: templateId === t.id ? `0 0 0 2px ${t.accent}` : 'none',
                  transition: 'all 150ms ease',
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: '10px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
            {TEMPLATES.find(t => t.id === templateId)?.name}
          </span>
        </div>
        <div className={styles.toolbarActions}>
          <button className={styles.toolBtn} onClick={() => window.print()}>
            <Printer size={13} /> Print
          </button>
          <button className={styles.toolBtnPrimary} onClick={handleExportPDF}>
            <Download size={13} /> Download PDF
          </button>
          <button className={styles.toolBtn} onClick={onClose} style={{ marginLeft: '1rem', color: 'var(--destructive)' }}>
            <X size={13} /> Close
          </button>
        </div>
      </div>

      {/* Paper */}
      <div className={styles.paperShadow}>
        <div ref={previewRef}>
          <TemplateEngine invoice={invoice} sender={sender} templateId={templateId} />
        </div>
      </div>
    </div>
  );
};
