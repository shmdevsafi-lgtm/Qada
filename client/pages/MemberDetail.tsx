import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import Footer from '../components/Footer';

interface Member {
  id: string;
  generated_id: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  age: number | null;
  gender: string | null;
  patrol_name: string | null;
  role_name: string | null;
  is_high_patrol: boolean | null;
  user_phone: string | null;
  guardian_first_name: string | null;
  guardian_last_name: string | null;
  guardian_relationship: string | null;
  guardian_cin: string | null;
  father_phone: string | null;
  mother_phone: string | null;
  home_phone: string | null;
  additional_info: string | null;
  pdf_url: string | null;
  qr_code_url: string | null;
  documents_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

const fields: { key: keyof Member; label: string }[] = [
  { key: 'id', label: 'ID' }, { key: 'generated_id', label: 'Identifiant généré' }, { key: 'birth_date', label: 'Date de naissance' }, { key: 'age', label: 'Âge' }, { key: 'gender', label: 'Genre' }, { key: 'patrol_name', label: 'Patrouille' }, { key: 'role_name', label: 'Rôle' }, { key: 'is_high_patrol', label: 'Haute patrouille' }, { key: 'user_phone', label: 'Téléphone membre' }, { key: 'guardian_first_name', label: 'Prénom responsable' }, { key: 'guardian_last_name', label: 'Nom responsable' }, { key: 'guardian_relationship', label: 'Lien responsable' }, { key: 'guardian_cin', label: 'CIN responsable' }, { key: 'father_phone', label: 'Téléphone père' }, { key: 'mother_phone', label: 'Téléphone mère' }, { key: 'home_phone', label: 'Téléphone domicile' }, { key: 'additional_info', label: 'Informations complémentaires' }, { key: 'pdf_url', label: 'PDF' }, { key: 'qr_code_url', label: 'QR Code' }, { key: 'documents_generated_at', label: 'Documents générés le' }, { key: 'created_at', label: 'Créé le' }, { key: 'updated_at', label: 'Mis à jour le' },
];

export default function MemberDetail() {
  const navigate = useNavigate();
  const { memberId } = useParams<{ memberId: string }>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMember = async () => {
      if (!memberId) return;
      try {
        setIsLoading(true);
        setError(null);
        const { data, error: queryError } = await supabase.from('member_profiles').select('*').eq('id', memberId).maybeSingle();
        if (queryError) { setError(`[${queryError.code}] ${queryError.message}`); return; }
        setMember(data);
      } catch (fetchError) {
        const message = fetchError instanceof Error ? fetchError.message : 'Erreur inconnue';
        setError(`Erreur lors du chargement du membre: ${message}`);
      } finally { setIsLoading(false); }
    };
    fetchMember();
  }, [memberId]);

  const renderValue = (key: keyof Member, value: Member[keyof Member]) => {
    if (value === null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if ((key === 'pdf_url' || key === 'qr_code_url') && typeof value === 'string') return <a href={value} target="_blank" rel="noreferrer" className="text-shm-red hover:text-red-700 underline">Ouvrir le fichier</a>;
    return String(value);
  };

  return <div className="min-h-screen bg-gray-50 flex flex-col"><Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} /><div className="flex flex-1"><Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} /><main className="flex-1 p-6 overflow-y-auto"><div className="max-w-4xl mx-auto"><button onClick={() => navigate('/members')} className="mb-6 flex items-center gap-2 text-shm-red hover:text-red-700 font-semibold"><ArrowLeft size={20} />Retour aux membres</button>{error && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-red-700 text-sm font-medium">{error}</p></div>}{isLoading && <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-shm-red" /><p className="ml-2 text-gray-600">Chargement du membre...</p></div>}{!isLoading && !error && !member && <div className="bg-white rounded-lg shadow-md p-8 text-center"><p className="text-gray-500">Membre introuvable</p></div>}{member && <article className="bg-white rounded-lg shadow-md p-8"><div className="mb-6 pb-6 border-b border-gray-200"><h1 className="text-3xl font-bold text-gray-900">{member.first_name || '—'} {member.last_name || ''}</h1></div><dl className="grid grid-cols-1 md:grid-cols-2 gap-6">{fields.map((field) => <div key={field.key}><dt className="text-sm font-medium text-gray-500">{field.label}</dt><dd className="mt-1 text-gray-900 whitespace-pre-line break-words">{renderValue(field.key, member[field.key])}</dd></div>)}</dl></article>}</div></main></div><Footer /></div>;
}
