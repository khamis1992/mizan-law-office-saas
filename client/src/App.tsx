import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import Home from './pages/Home';
import { Route, Switch } from 'wouter';

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster richColors position="top-center" /><Switch><Route path="/platform/:section"><Home /></Route><Route><Home /></Route></Switch></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
