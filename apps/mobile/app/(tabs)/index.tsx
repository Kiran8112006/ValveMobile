import { AdminOverviewScreen } from '../../components/admin/AdminOverviewScreen';
import { HomeScreen } from '../../components/customer/HomeScreen';
import { useAuth } from '../../contexts/AuthContext';

export default function TabsIndex() {
  const { role } = useAuth();
  return role === 'admin' ? <AdminOverviewScreen /> : <HomeScreen />;
}