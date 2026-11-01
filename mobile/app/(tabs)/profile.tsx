import { formatDate, loc } from "@mawah/shared/format";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Alert, Platform, View } from "react-native";
import { useResource } from "../../src/api";
import { API_URL, APP_VERSION } from "../../src/config";
import { siteLinks, telLink, whatsappLink } from "../../src/lib/links";
import { openApp, openPage } from "../../src/open";
import { usePrefs, type LookPref } from "../../src/prefs";
import { useSession } from "../../src/session";
import { RADIUS } from "../../src/theme";
import type { Certificates, SiteInfo } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Icon, type IconName } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { Txt } from "../../src/ui/Txt";

export default function Profile() {
  const { c, t, lang, setLang, lookPref, setLookPref } = usePrefs();
  const { status, me, logout } = useSession();
  const router = useRouter();
  const signedIn = status === "in" && !!me;
  const site = useResource<SiteInfo>("/api/site");
  const certs = useResource<Certificates>(signedIn ? "/api/student/certificates" : null);
  const links = siteLinks(API_URL, lang);
  const contact = site.data?.site.contact;
  const wa = contact ? whatsappLink(contact.whatsapp) : null;
  const tel = contact ? telLink(contact.phone) : null;

  const askLogout = () => {
    if (Platform.OS === "web") return void logout();
    Alert.alert(t("profile.logout"), t("profile.logoutAsk"), [
      { text: t("common.close"), style: "cancel" },
      { text: t("profile.logout"), style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <Page onRefresh={() => void certs.refresh()} refreshing={certs.refreshing}>
      <SectionTitle title={t("profile.title")} />

      {signedIn ? (
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
              <Txt v="title" color={c.onAccent}>
                {(me.name.trim()[0] ?? "M").toUpperCase()}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="heading" numberOfLines={1}>
                {me.name}
              </Txt>
              <Txt v="small" color={c.text3}>
                {t("profile.studentId")}: {me.code}
              </Txt>
            </View>
          </View>
          {me.phone ? <Row icon="phone" label={t("profile.phone")} value={me.phone} /> : null}
          {me.email ? <Row icon="mail" label={t("profile.email")} value={me.email} /> : null}
        </Card>
      ) : (
        <Card style={{ gap: 12 }}>
          <Txt v="body" color={c.text2}>
            {t("profile.loggedOut")}
          </Txt>
          <Btn title={t("profile.login")} onPress={() => router.push("/login")} />
        </Card>
      )}

      <Group title={t("profile.language")}>
        <Segmented
          value={lang}
          options={[
            { value: "bn", label: "বাংলা" },
            { value: "en", label: "English" },
          ]}
          onChange={(v) => setLang(v as "bn" | "en")}
        />
      </Group>

      <Group title={t("profile.look")}>
        <Segmented
          value={lookPref}
          options={[
            { value: "night", label: t("profile.look.night"), icon: "moon" },
            { value: "day", label: t("profile.look.day"), icon: "sun" },
            { value: "system", label: t("profile.look.system") },
          ]}
          onChange={(v) => setLookPref(v as LookPref)}
        />
      </Group>

      {signedIn ? (
        <Group title={t("profile.certificates")}>
          <Card pad={false}>
            {(certs.data?.certificates ?? []).filter((x) => !x.revoked_at).length === 0 ? (
              <Txt v="small" color={c.text3} style={{ padding: 16 }}>
                {t("profile.noCertificates")}
              </Txt>
            ) : (
              (certs.data?.certificates ?? [])
                .filter((x) => !x.revoked_at)
                .map((cert, i) => (
                  <Item key={cert.id} first={i === 0} icon="award" label={loc(cert, "course_title", lang)} sub={formatDate(cert.issued_at, lang)} onPress={() => void openPage(links.certificate(cert.code), c.surface)} />
                ))
            )}
          </Card>
        </Group>
      ) : null}

      <Group title={t("profile.support")}>
        <Card pad={false}>
          {wa ? <Item first icon="whatsapp" label={t("profile.whatsapp")} onPress={() => void openApp(wa)} /> : null}
          {tel ? <Item first={!wa} icon="phone" label={`${t("profile.call")} · ${contact?.phone}`} onPress={() => void openApp(tel)} /> : null}
          {contact?.messenger ? <Item icon="messenger" label={t("profile.messenger")} onPress={() => void openApp(contact.messenger)} /> : null}
          {contact?.email ? <Item icon="mail" label={t("profile.mail")} onPress={() => void openApp(`mailto:${contact.email}`)} /> : null}
          <Item first={!wa && !tel} icon="globe" label={t("profile.website")} onPress={() => void openPage(links.home, c.surface)} />
        </Card>
      </Group>

      <Group title={t("profile.policies")}>
        <Card pad={false}>
          <Item first icon="shield" label={t("profile.privacy")} onPress={() => void openPage(links.policy("privacy"), c.surface)} />
          <Item icon="file" label={t("profile.terms")} onPress={() => void openPage(links.policy("terms"), c.surface)} />
          <Item icon="refresh" label={t("profile.refund")} onPress={() => void openPage(links.policy("refund"), c.surface)} />
        </Card>
      </Group>

      {signedIn ? <Btn kind="secondary" icon="logout" title={t("profile.logout")} onPress={askLogout} /> : null}

      <Txt v="tiny" color={c.text3} center>
        MAWAH Academy · {t("profile.version", { v: APP_VERSION })}
      </Txt>
    </Page>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { c } = usePrefs();
  return (
    <View style={{ gap: 8 }}>
      <Txt v="tiny" color={c.text3} style={{ textTransform: "uppercase", letterSpacing: 0.8, marginLeft: 4 }}>
        {title}
      </Txt>
      {children}
    </View>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { c } = usePrefs();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Icon name={icon} size={18} color={c.text3} />
      <Txt v="small" color={c.text3} style={{ width: 70 }}>
        {label}
      </Txt>
      <Txt v="body" style={{ flex: 1 }} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}

function Item({ icon, label, sub, onPress, first }: { icon: IconName; label: string; sub?: string; onPress: () => void; first?: boolean }) {
  const { c } = usePrefs();
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scale={0.99} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={icon === "whatsapp" ? "#25D366" : c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt v="label" numberOfLines={2}>
          {label}
        </Txt>
        {sub ? (
          <Txt v="small" color={c.text3}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Icon name="chevronRight" size={18} color={c.text3} />
    </Press>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string; icon?: IconName }[]; onChange: (v: string) => void }) {
  const { c } = usePrefs();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", backgroundColor: c.surface, borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.line, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={{ flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", minHeight: 42, borderRadius: RADIUS.s, backgroundColor: on ? c.accent : "transparent" }}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={on ? c.onAccent : c.text2} /> : null}
            <Txt v="label" color={on ? c.onAccent : c.text2} style={{ fontSize: 13.5 }} numberOfLines={1}>
              {o.label}
            </Txt>
          </Press>
        );
      })}
    </View>
  );
}
