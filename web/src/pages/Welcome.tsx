import { useNavigate } from 'react-router-dom';

const FEATURES = [
  { ico: '🔗', title: 'Connect securely', text: 'Link your banks through Plaid — your credentials never touch our servers.' },
  { ico: '🧠', title: 'Auto-categorized', text: 'Every transaction sorted and grouped by merchant, fully searchable in the ledger.' },
  { ico: '📈', title: 'Reports & PDFs', text: 'Weekly to yearly reports with charts and a polished PDF you can download.' },
  { ico: '🔁', title: 'Subscriptions & advisor', text: 'Spot recurring charges automatically and get personalized savings tips.' }
];

export default function Welcome() {
  const navigate = useNavigate();
  const done = (to: string) => { sessionStorage.setItem('of_welcomed', '1'); navigate(to); };
  return (
    <div className="welcome">
      <div className="wbrand">Osborn <span className="grad">Finance</span></div>
      <h1 className="wtitle">See every dollar.<br /><span className="grad">Across every account.</span></h1>
      <p className="wsub">Osborn Finance links your bank accounts, automatically categorizes your spending, and turns it into clear dashboards, reports, subscription tracking, and an AI advisor — so you always know where your money goes.</p>
      <div className="wcta">
        <button className="btn primary" onClick={() => done('/plans')}>Choose your plan →</button>
        <button className="btn" onClick={() => done('/')}>Look around first</button>
      </div>
      <div className="wfeat-grid">
        {FEATURES.map(f => (
          <div className="wfeat" key={f.title}>
            <div className="wfeat-ico">{f.ico}</div>
            <div className="wfeat-title">{f.title}</div>
            <div className="wfeat-text">{f.text}</div>
          </div>
        ))}
      </div>
      <div className="wnote">Every plan starts with a 7-day free trial · cancel anytime</div>
    </div>
  );
}
