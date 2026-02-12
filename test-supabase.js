import { supabase } from './lib/supabase.js';

async function testConnection() {
    console.log('Testing Supabase connection...');
    const { data, error } = await supabase.from('test').select('*').limit(1);

    if (error) {
        if (error.code === '42P01') {
            console.log('Connection successful, but table "test" does not exist (Expected).');
        } else {
            console.error('Connection error:', error);
        }
    } else {
        console.log('Connection successful! Data:', data);
    }
}

testConnection();
