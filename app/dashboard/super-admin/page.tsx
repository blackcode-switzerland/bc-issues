import { redirect } from 'next/navigation'

export default function SuperAdminPage() {
  redirect('/dashboard/super-admin/users')
}
