import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout, RequirePerm } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { ForcePasswordChange, Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

// every screen except the dashboard is loaded on demand: the admin opens fast, and heavy parts (charts, editors) cost nothing until used
const lazyPage = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(async () => ({ default: (await loader())[name] }));

const Courses = lazyPage(() => import("./pages/Courses"), "Courses");
const CourseEditor = lazyPage(() => import("./pages/CourseEditor"), "CourseEditor");
const CourseView = lazyPage(() => import("./pages/CourseView"), "CourseView");
const Instructors = lazyPage(() => import("./pages/Content"), "Instructors");
const Categories = lazyPage(() => import("./pages/Content"), "Categories");
const Blog = lazyPage(() => import("./pages/Content"), "Blog");
const Bundles = lazyPage(() => import("./pages/Content"), "Bundles");
const Coupons = lazyPage(() => import("./pages/Content"), "Coupons");
const Banners = lazyPage(() => import("./pages/Banners"), "Banners");
const Orders = lazyPage(() => import("./pages/Sales"), "Orders");
const Students = lazyPage(() => import("./pages/Sales"), "Students");
const Reviews = lazyPage(() => import("./pages/Engagement"), "Reviews");
const Questions = lazyPage(() => import("./pages/Engagement"), "Questions");
const Certificates = lazyPage(() => import("./pages/Engagement"), "Certificates");
const Signups = lazyPage(() => import("./pages/Engagement"), "Signups");
const Messages = lazyPage(() => import("./pages/Engagement"), "Messages");
const Chatbot = lazyPage(() => import("./pages/Chatbot"), "Chatbot");
const Reports = lazyPage(() => import("./pages/Reports"), "Reports");
const Staff = lazyPage(() => import("./pages/Staff"), "Staff");
const Settings = lazyPage(() => import("./pages/Settings"), "Settings");
const Activity = lazyPage(() => import("./pages/Activity"), "Activity");
const Help = lazyPage(() => import("./pages/Help"), "Help");

const guard = (perm: Parameters<typeof RequirePerm>[0]["perm"], el: React.ReactNode) => <RequirePerm perm={perm}>{el}</RequirePerm>;

export default function App() {
  const { staff } = useAuth();
  if (staff === undefined) return <Spinner />;
  if (!staff) return <Login />;
  if (staff.must_change_password) return <ForcePasswordChange />;

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={guard("dashboard:read", <Dashboard />)} />
          <Route path="courses" element={guard("courses:read", <Courses />)} />
          <Route path="courses/new" element={guard("courses:write", <CourseEditor />)} />
          <Route path="courses/:id" element={guard("courses:read", <CourseView />)} />
          <Route path="courses/:id/edit" element={guard("courses:read", <CourseEditor />)} />
          <Route path="instructors" element={guard("instructors:read", <Instructors />)} />
          <Route path="categories" element={guard("categories:read", <Categories />)} />
          <Route path="orders" element={guard("orders:read", <Orders />)} />
          <Route path="students" element={guard("students:read", <Students />)} />
          <Route path="reviews" element={guard("reviews:read", <Reviews />)} />
          <Route path="questions" element={guard("questions:read", <Questions />)} />
          <Route path="blog" element={guard("blog:read", <Blog />)} />
          <Route path="coupons" element={guard("coupons:read", <Coupons />)} />
          <Route path="bundles" element={guard("bundles:read", <Bundles />)} />
          <Route path="banners" element={guard("banners:read", <Banners />)} />
          <Route path="certificates" element={guard("certificates:read", <Certificates />)} />
          <Route path="signups" element={guard("signups:read", <Signups />)} />
          <Route path="messages" element={guard("messages:read", <Messages />)} />
          <Route path="chatbot" element={guard("chatbot:read", <Chatbot />)} />
          <Route path="reports" element={guard("reports:learning", <Reports />)} />
          <Route path="staff" element={guard("staff:read", <Staff />)} />
          <Route path="settings" element={guard("settings:read", <Settings />)} />
          <Route path="activity" element={guard("activity:read", <Activity />)} />
          <Route path="help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
