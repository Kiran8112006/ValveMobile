import { AdminHistoryScreen } from '../../components/admin/AdminHistoryScreen';
import { CustomerHistoryScreen } from '../../components/customer/HistoryScreen';
import { useAuth } from '../../contexts/AuthContext';

export default function HistoryTab() {
  const { role } = useAuth();
  return role === 'admin' ? <AdminHistoryScreen /> : <CustomerHistoryScreen />;
}
