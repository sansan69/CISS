import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/app_role.dart';
import '../../../core/models/auth_session.dart';
import '../application/auth_controller.dart';

class LoginHubScreen extends ConsumerWidget {
  const LoginHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AuthSession?>(authSessionProvider, (_, AuthSession? next) {
      if (next == null) {
        return;
      }

      switch (next.role) {
        case AppRole.guard:
          context.go('/guard');
        case AppRole.fieldOfficer:
          context.go('/field-officer');
      }
    });

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
          children: <Widget>[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFEAF1F8),
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Text(
                'CISS WORKFORCE MOBILE',
                style: TextStyle(
                  color: Color(0xFF0B4F82),
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.4,
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Native daily-use app for guards and field officers.',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            Text(
              'Built on top of the current CISS Workforce platform for attendance, profile, training, evaluations, work orders, and field reporting.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 28),
            _RoleCard(
              title: 'Guard App',
              subtitle:
                  'Attendance, profile, salary slips, training, evaluations, leave, and incident reporting.',
              buttonLabel: 'Open Guard Flow',
              onPressed: () => ref.read(authControllerProvider).signInAsGuard(),
            ),
            const SizedBox(height: 16),
            _RoleCard(
              title: 'Field Officer App',
              subtitle:
                  'Work orders, guard visibility, visit reports, training reports, and field operations.',
              buttonLabel: 'Open Field Officer Flow',
              onPressed: () =>
                  ref.read(authControllerProvider).signInAsFieldOfficer(),
            ),
            const SizedBox(height: 20),
            Text(
              'Current build uses demo sessions to validate the mobile architecture. Real Firebase and API integration should replace the demo auth controller next.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.title,
    required this.subtitle,
    required this.buttonLabel,
    required this.onPressed,
  });

  final String title;
  final String subtitle;
  final String buttonLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: const Color(0xFFE4EBF3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: onPressed,
            child: Text(buttonLabel),
          ),
        ],
      ),
    );
  }
}
