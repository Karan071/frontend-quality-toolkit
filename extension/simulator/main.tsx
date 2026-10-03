import { createRoot } from 'react-dom/client';
import { Simulator } from './Simulator';
import '../sidepanel/styles.css';
import './simulator.css';

createRoot(document.getElementById('root')!).render(<Simulator />);
