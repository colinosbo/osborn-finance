import { Link } from 'react-router-dom';

export default function Budgets() {
  return (
    <>
      <div className="sec-head"><span className="sec-num">05</span><span className="sec-title">Budgets</span></div>
      <div className="sec-sub">Per-category monthly targets with alerts</div>
      <div className="panel coming-soon">
        <div className="cs-ico">🎯</div>
        <div className="cs-title">Budgets are coming soon</div>
        <div className="cs-text">
          Set a monthly target for each category and get nudged at 80% and 100%. While we build it,
          your <Link to="/reports">Reports</Link> already break spending down by category, and the
          {' '}<Link to="/advisor">Advisor</Link> flags where you can cut back.
        </div>
        <span className="cs-badge">On the roadmap</span>
      </div>
    </>
  );
}
