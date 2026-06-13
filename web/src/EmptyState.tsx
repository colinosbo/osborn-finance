import { Link } from 'react-router-dom';
import { Icon, type IconName } from './icons';

interface Props {
  icon: IconName;
  eyebrow?: string;
  title: string;
  sub: string;
  cta?: { to: string; label: string } | null;
  secondary?: { to: string; label: string } | null;
  hints?: { icon: IconName; label: string }[];
}

const DEFAULT_CTA = { to: '/accounts', label: 'Connect a bank' };

export default function EmptyState({ icon, eyebrow = 'Getting started', title, sub, cta = DEFAULT_CTA, secondary, hints }: Props) {
  return (
    <div className="emptyx">
      <div className="emptyx-mark"><Icon name={icon} size={26} /></div>
      {eyebrow && <div className="emptyx-eyebrow">{eyebrow}</div>}
      <h2 className="emptyx-title">{title}</h2>
      <p className="emptyx-sub">{sub}</p>
      {(cta || secondary) && (
        <div className="emptyx-cta">
          {cta && <Link to={cta.to} className="btn primary" style={{ textDecoration: 'none' }}>{cta.label}</Link>}
          {secondary && <Link to={secondary.to} className="btn ghost" style={{ textDecoration: 'none' }}>{secondary.label}</Link>}
        </div>
      )}
      {hints && hints.length > 0 && (
        <div className="emptyx-caps">
          {hints.map(h => (
            <div className="emptyx-cap" key={h.label}>
              <span className="emptyx-cap-ico"><Icon name={h.icon} size={16} /></span>
              <span>{h.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
