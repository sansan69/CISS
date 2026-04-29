import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardIncidentsScreen extends StatelessWidget {
  const GuardIncidentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Incidents',
      subtitle: 'Report and track incidents',
      children: <Widget>[
        SectionCard(
          title: 'Report Incident',
          subtitle: 'Capture category, severity, site, notes, and media.',
          icon: Icons.warning_amber_rounded,
        ),
        SectionCard(
          title: 'Incident History',
          subtitle: 'Track reported incidents and status updates.',
          icon: Icons.assignment_outlined,
        ),
      ],
    );
  }
}
