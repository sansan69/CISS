import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/login_hub_screen.dart';
import '../../features/field_officer/presentation/field_officer_shell.dart';
import '../../features/guard/presentation/guard_shell.dart';

final GoRouter appRouter = GoRouter(
  initialLocation: '/',
  routes: <RouteBase>[
    GoRoute(
      path: '/',
      builder: (BuildContext context, GoRouterState state) {
        return const LoginHubScreen();
      },
    ),
    GoRoute(
      path: '/guard',
      builder: (BuildContext context, GoRouterState state) {
        return const GuardShell();
      },
    ),
    GoRoute(
      path: '/field-officer',
      builder: (BuildContext context, GoRouterState state) {
        return const FieldOfficerShell();
      },
    ),
  ],
);

