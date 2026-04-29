import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class FieldOfficerGuardsScreen extends StatelessWidget {
  const FieldOfficerGuardsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Guards',
      subtitle: 'District guard visibility',
      children: <Widget>[
        SectionCard(
          title: 'Guard Directory',
          subtitle: 'Assigned guards, profiles, and quick field lookup.',
          icon: Icons.groups_2_outlined,
        ),
      ],
    );
  }
}

