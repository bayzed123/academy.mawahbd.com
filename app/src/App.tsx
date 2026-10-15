import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { RequireAuth, Shell } from "./components/Shell";
import { Spinner } from "./components/ui";
import { Forgot, Login, Register, Reset } from "./pages/Auth";
import { MyLearning } from "./pages/Learning";
import { NotFound } from "./pages/NotFound";

// heavier screens load on demand so the first paint (login / My Learning) stays small and fast
const CourseOverview = lazy(() => import("./pages/Course").then((m) => ({ default: m.CourseOverview })));
const LessonPlayer = lazy(() => import("./pages/Lesson").then((m) => ({ default: m.LessonPlayer })));
const ReviewPage = lazy(() => import("./pages/Review").then((m) => ({ default: m.ReviewPage })));
const Preview = lazy(() => import("./pages/Lesson").then((m) => ({ default: m.Preview })));
const Checkout = lazy(() => import("./pages/Checkout"));
const Orders = lazy(() => import("./pages/Orders").then((m) => ({ default: m.Orders })));
const OrderDetail = lazy(() => import("./pages/Orders").then((m) => ({ default: m.OrderDetail })));
const Certificates = lazy(() => import("./pages/Account").then((m) => ({ default: m.Certificates })));
const Profile = lazy(() => import("./pages/Account").then((m) => ({ default: m.Profile })));

const guard = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={guard(<MyLearning />)} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot" element={<Forgot />} />
          <Route path="reset/:token" element={<Reset />} />
          <Route path="preview/:lessonId" element={<Preview />} />
          <Route path="review/:slug" element={guard(<ReviewPage />)} />
          <Route path="learn/:slug" element={guard(<CourseOverview />)} />
          <Route path="learn/:slug/:lessonId" element={guard(<LessonPlayer />)} />
          <Route path="checkout" element={guard(<Checkout />)} />
          <Route path="orders" element={guard(<Orders />)} />
          <Route path="orders/:publicId" element={guard(<OrderDetail />)} />
          <Route path="certificates" element={guard(<Certificates />)} />
          <Route path="profile" element={guard(<Profile />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
