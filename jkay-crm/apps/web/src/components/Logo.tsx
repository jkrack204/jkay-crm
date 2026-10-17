import light from '../assets/logo-light.png';
import dark from '../assets/logo-dark.png';

/** JK RACKS wordmark. Both versions render; CSS shows the one for the current theme. */
export function Logo({ height = 16 }: { height?: number }) {
  return (
    <span className="logo" style={{ height }}>
      <img className="logo--light" src={light} alt="JK Racks" height={height} />
      <img className="logo--dark" src={dark} alt="" aria-hidden height={height} />
    </span>
  );
}
