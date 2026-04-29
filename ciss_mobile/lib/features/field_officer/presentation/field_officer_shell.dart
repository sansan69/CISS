import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';
import 'screens/field_officer_dashboard_screen.dart';
import 'screens/field_officer_guards_screen.dart';
import 'screens/field_officer_reports_screen.dart';
import 'screens/field_officer_work_orders_screen.dart';

class FieldOfficerShell extends ConsumerStatefulWidget {
  const FieldOfficerShell({super.key});

  @override
  ConsumerState<FieldOfficerShell> createState() => _FieldOfficerShellState();
}

class _FieldOfficerShellState extends ConsumerState<FieldOfficerShell> {
  int _index = 0;

  static const List<_FieldOfficerTab> _tabs = <_FieldOfficerTab>[
    _FieldOfficerTab(
      label: 'Home',
      icon: Icons.dashboard_outlined,
      screen: FieldOfficerDashboardScreen(),
    ),
    _FieldOfficerTab(
      label: 'Work Orders',
      icon: Icons.assignment_turned_in_outlined,
      screen: FieldOfficerWorkOrdersScreen(),
    ),
    _FieldOfficerTab(
      label: 'Guards',
      icon: Icons.groups_2_outlined,
      screen: FieldOfficerGuardsScreen(),
    ),
    _FieldOfficerTab(
      label: 'Reports',
      icon: Icons.edit_note_rounded,
      screen: FieldOfficerReportsScreen(),
    ),
    _FieldOfficerTab(
      label: 'More',
      icon: Icons.more_horiz_rounded,
      screen: FieldOfficerMoreScreen(),
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
              (_FieldOfficerTab tab) => NavigationDestination(
                icon: Icon(tab.icon),
                label: tab.label,
              ),
            )
            .toList(),
      ),
    );
  }
}

class _FieldOfficerTab {
  const _FieldOfficerTab({
    required this.label,
    required this.icon,
    required this.screen,
  });

  final String label;
  final IconData icon;
  final Widget screen;
}

class FieldOfficerMoreScreen extends ConsumerWidget {
  const FieldOfficerMoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
      children: <Widget>[
        ListTile(
          leading: const Icon(Icons.assignment_late_outlined),
          title: const Text('Incident Feed'),
          subtitle: const Text('Review field incidents and escalations'),
          onTap: () {},
        ),
        ListTile(
          leading: const Icon(Icons.place_outlined),
          title: const Text('Sites'),
          subtitle: const Text('District sites and duty coverage'),
          onTap: () {},
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

