import { createClient } from "@supabase/supabase-js";

export class SupabaseAuth {
  constructor({ supabaseUrl = "", supabasePublishableKey = "", authProviders = ["google"] } = {}) {
    this.providers = new Set(Array.isArray(authProviders) ? authProviders : ["google"]);
    this.client = supabaseUrl && supabasePublishableKey
      ? createClient(supabaseUrl, supabasePublishableKey, {
          auth: { autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", persistSession: true },
        })
      : null;
    this.session = null;
    this.listeners = new Set();
  }

  async init() {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    this.setSession(data.session);
    this.client.auth.onAuthStateChange((_event, session) => this.setSession(session));
    return this.session;
  }

  setSession(session) {
    this.session = session || null;
    for (const listener of this.listeners) listener(this.session);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  accessToken() { return this.session?.access_token || ""; }

  async signInWithProvider(provider) {
    if (!this.client) throw new Error("Accounts are not configured on this server yet.");
    const { error } = await this.client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}${location.pathname}` },
    });
    if (error) throw error;
  }

  async signIn(email, password) {
    if (!this.client) throw new Error("Accounts are not configured on this server yet.");
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUp(email, password) {
    if (!this.client) throw new Error("Accounts are not configured on this server yet.");
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}${location.pathname}` },
    });
    if (error) throw error;
    return data;
  }

  async signOut() {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }
}
