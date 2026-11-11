import { CameraScreen } from './CameraScreen';
import { SessionsScreen } from './SessionsScreen';
import { PlayerScreen } from './PlayerScreen';
import { AboutScreen } from './AboutScreen';
import { useRoute } from './route';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'camera':
      return <CameraScreen />;
    case 'sessions':
      return <SessionsScreen />;
    case 'session':
      return <PlayerScreen id={route.id} />;
    case 'about':
      return <AboutScreen />;
  }
}
