import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';
import 'screens/guard_attendance_screen.dart';
import 'screens/guard_dashboard_screen.dart';
import 'screens/guard_evaluations_screen.dart';
import 'screens/guard_incidents_screen.dart';
import 'screens/guard_leave_screen.dart';
import 'screens/guard_payslips_screen.dart';
import 'screens/guard_profile_screen.dart';
import 'screens/guard_training_screen.dart';

class GuardShell extends ConsumerStatefulWidget {
  const GuardShell({super.key});

  @override
  ConsumerState<GuardShell> createState() => _GuardShellState();
}

class _GuardShellState extends ConsumerState<GuardShell> {
  int _index = 0;

  static const List<_GuardTab> _tabs = <_GuardTab>[
    _GuardTab(
      label: 'Home',
      icon: Icons.home_rounded,
      screen: GuardDashboardScreen(),
    ),
    _GuardTab(
      label: 'Attendance',
      icon: Icons.fact_check_rounded,
      screen: GuardAttendanceScreen(),
    ),
    _GuardTab(
      label: 'Training',
      icon: Icons.school_rounded,
      screen: GuardTrainingScreen(),
    ),
    _GuardTab(
      label: 'Payslips',
      icon: Icons.account_balance_wallet_rounded,
      screen: GuardPayslipsScreen(),
    ),
    _GuardTab(
      label: 'More',
      icon: Icons.more_horiz_rounded,
      screen: GuardMoreScreen(),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _tabs[_index].screen,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (int index) => setState(() => _index = index),
        destinations: _tabs
            .map(
              (_GuardTab tab) => NavigationDestination(
                icon: Icon(tab.icon),
                label: tab.label,
              ),
            )
            .toList(),
      ),
    );
  }
}

class _GuardTab {
  const _GuardTab({
    required this.label,
    required this.icon,
    required this.screen,
  });

  final String label;
  final IconData icon;
  final Widget screen;
}

class GuardMoreScreen extends ConsumerWidget {
  const GuardMoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
      children: <Widget>[
        ListTile(
          title: const Text('Profile'),
          subtitle: const Text('Personal and employment details'),
          leading: const Icon(Icons.person_outline_rounded),
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const GuardProfileScreen(),
              ),
            );
          },
        ),
        ListTile(
          title: const Text('Leave'),
          subtitle: const Text('Apply and review leave requests'),
          leading: const Icon(Icons.event_available_rounded),
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const GuardLeaveScreen(),
              ),
            );
          },
        ),
        ListTile(
          title: const Text('Evaluations'),
          subtitle: const Text('Quiz and performance records'),
          leading: const Icon(Icons.workspace_premium_outlined),
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const GuardEvaluationsScreen(),
              ),
            );
          },
        ),
        ListTile(
          title: const Text('Incidents'),
          subtitle: const Text('Report incidents from field'),
          leading: const Icon(Icons.report_gmailerrorred_outlined),
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const GuardIncidentsScreen(),
              ),
            );
          },
        ),
        const SizedBox(height: 24),
        OutlinedButton(
          onPressed: () => ref.read(authControllerProvider).signOut(),
          child: const Text('Sign Out'),
        ),
      ],
    );
  }
}

